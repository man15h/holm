// The AI integrations' calls (Claude, OpenAI, OpenAI-compatible): the
// system prompt, checks on the conversation, and the streaming readers. Pure
// fetch and no server modules, so the same code runs on Holm's server and,
// for an integration the operator set to `calls: browser`, in the browser.
//
// Answers are answer-only by design: the model gets the conversation and
// nothing else. No tools, no apps, no Holm data, and nothing is stored.

export const SYSTEM_PROMPT =
	'You answer questions typed into the search bar of Holm, a personal dashboard. ' +
	'Lead with the answer in a sentence or two, then add only the detail that helps. ' +
	'Use short Markdown (lists, bold, code) where it makes the answer easier to scan; no headings for short answers. ' +
	'You cannot browse the web or see anything of the user\'s, so say so when a question needs that, and be clear when you are unsure.';

export const MAX_OUTPUT_TOKENS = 1024;

/** Yielded by an `answers.stream` after the text when the answer hit MAX_OUTPUT_TOKENS. */
export const CUT_OFF = Object.freeze({ cutOff: true });
/** A stream's last piece when the API reports what the answer cost: { usage: { input, output } } in tokens. */
export const usage = (input, output) => ({ usage: { input: input || 0, output: output || 0 } });
export const MAX_MESSAGES = 20;
export const MAX_MESSAGE_CHARS = 4000;
// Earlier answers come back with each follow-up and may run past
// MAX_MESSAGE_CHARS, so only the total bounds them.
const MAX_TOTAL_CHARS = 40000;

/**
 * The conversation from the browser, checked: 1 to MAX_MESSAGES turns that
 * alternate user and assistant, starting and ending with the user, each
 * question up to MAX_MESSAGE_CHARS.
 * Returns { ok: true, messages } or { ok: false, message }.
 */
export function checkMessages(input) {
	if (!Array.isArray(input) || input.length === 0) return { ok: false, message: 'messages must be a non-empty list' };
	if (input.length > MAX_MESSAGES) return { ok: false, message: `A conversation holds up to ${MAX_MESSAGES} messages` };
	const messages = [];
	let total = 0;
	for (let i = 0; i < input.length; i++) {
		const m = input[i];
		const role = i % 2 === 0 ? 'user' : 'assistant';
		if (m?.role !== role) return { ok: false, message: 'Messages must alternate, starting with the user' };
		const content = typeof m.content === 'string' ? m.content.trim() : '';
		if (!content) return { ok: false, message: 'A message is empty' };
		if (role === 'user' && content.length > MAX_MESSAGE_CHARS) return { ok: false, message: `A message is longer than ${MAX_MESSAGE_CHARS} characters` };
		total += content.length;
		messages.push({ role, content });
	}
	if (messages[messages.length - 1].role !== 'user') return { ok: false, message: 'The last message must be the user\'s' };
	if (total > MAX_TOTAL_CHARS) return { ok: false, message: 'This conversation is too long; start a new one' };
	return { ok: true, messages };
}

/** Server-sent events from a fetch Response: yields { event, data } per event. */
export async function* sseEvents(res) {
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const { done, value } = await reader.read();
			buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
			let cut;
			while ((cut = buffer.search(/\r?\n\r?\n/)) !== -1) {
				const block = buffer.slice(0, cut);
				buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
				const ev = parseEvent(block);
				if (ev) yield ev;
			}
			if (done) break;
		}
		const ev = parseEvent(buffer);
		if (ev) yield ev;
	} finally {
		reader.releaseLock();
	}
}

function parseEvent(block) {
	let event = 'message';
	const data = [];
	for (const line of block.split(/\r?\n/)) {
		if (line.startsWith('event:')) event = line.slice(6).trim();
		else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
	}
	return data.length ? { event, data: data.join('\n') } : null;
}

/** The text of an error reply, as the API words it when it does. */
export async function apiError(res, name) {
	let detail = '';
	try {
		const body = await res.json();
		detail = body?.error?.message || body?.message || (typeof body?.error === 'string' ? body.error : '');
	} catch {}
	// The API's own words tell a bad key from a key that can't use the model.
	const said = detail ? `: ${detail}` : '';
	if (res.status === 401) return `${name} rejected the API key${said}`;
	if (res.status === 403) return `${name} refused this key${said || ' (no permission, or no access to this model)'}`;
	if (res.status === 429) return `${name} is rate limiting this key${said}`;
	return `${name} returned ${res.status}${said}`;
}

export function stripTrailingSlash(url) {
	return String(url || '').replace(/\/+$/, '');
}

// ── OpenAI chat completions, shared by OpenAI and OpenAI-compatible servers ──

export function openAiHeaders(key) {
	return {
		'content-type': 'application/json',
		accept: 'application/json',
		...(key ? { Authorization: `Bearer ${key}` } : {})
	};
}

/** The model ids at `<base>/models`, or throws with the API's error. */
export async function listOpenAiModels({ base, key, fetch, name }) {
	const res = await fetch(`${base}/models`, { headers: openAiHeaders(key) });
	if (!res.ok) throw new Error(await apiError(res, name));
	const data = await res.json();
	return (Array.isArray(data?.data) ? data.data : []).map((m) => String(m?.id || '')).filter(Boolean);
}

/** Streams a chat completion from `<base>/chat/completions`, yielding text. */
export async function* streamOpenAiChat({ base, key, model, system, messages, fetch, name, extra = {} }) {
	const res = await fetch(`${base}/chat/completions`, {
		method: 'POST',
		headers: { ...openAiHeaders(key), accept: 'text/event-stream' },
		body: JSON.stringify({
			model,
			stream: true,
			messages: [{ role: 'system', content: system }, ...messages],
			...extra
		})
	});
	if (!res.ok) throw new Error(await apiError(res, name));
	for await (const { data } of sseEvents(res)) {
		if (data === '[DONE]') return;
		let chunk;
		try {
			chunk = JSON.parse(data);
		} catch {
			continue;
		}
		if (chunk?.error) throw new Error(`${name}: ${chunk.error.message || 'the answer stopped'}`);
		const choice = chunk?.choices?.[0];
		const text = choice?.delta?.content;
		if (typeof text === 'string' && text) yield text;
		if (choice?.finish_reason === 'length') yield CUT_OFF;
		if (chunk?.usage) yield usage(chunk.usage.prompt_tokens, chunk.usage.completion_tokens);
	}
}

// ── Claude and OpenAI, the two that can be called from the browser ──

export const DEFAULT_MODELS = { claude: 'claude-haiku-4-5', openai: 'gpt-4.1-mini' };

const ANTHROPIC = 'https://api.anthropic.com/v1';
const OPENAI = 'https://api.openai.com/v1';

const modelOf = (id, config) => String(config?.model || '').trim() || DEFAULT_MODELS[id];

// Anthropic refuses a browser's request without the opt-in header.
function claudeHeaders(config, browser) {
	return {
		'x-api-key': config.key,
		'anthropic-version': '2023-06-01',
		accept: 'application/json',
		...(browser ? { 'anthropic-dangerous-direct-browser-access': 'true' } : {})
	};
}

// Claude's display names ("Claude Opus 5.5") by model id; the same for every key.
const claudeNames = new Map();

/**
 * Test and stream for each, given `fetch` and the user's config. `browser`
 * is true when the page calls the API itself.
 * @type {Record<'claude'|'openai', { test: Function, stream: Function }>}
 */
export const PROVIDERS = {
	claude: {
		async test({ config, fetch, browser = false }) {
			if (!config?.key) return { ok: false, message: 'An API key is required' };
			const model = modelOf('claude', config);
			try {
				const res = await fetch(`${ANTHROPIC}/models/${encodeURIComponent(model)}`, { headers: claudeHeaders(config, browser) });
				if (res.status === 404) return { ok: false, message: `The key works, but there is no model “${model}”` };
				if (!res.ok) return { ok: false, message: await apiError(res, 'Anthropic') };
				const data = await res.json();
				if (data?.display_name) claudeNames.set(model, data.display_name);
				return { ok: true, message: `Connected — answers come from ${data?.display_name || model}` };
			} catch (err) {
				return { ok: false, message: `Connection failed: ${err.message}` };
			}
		},
		/** The model's display name for an answer's byline, or its id if Anthropic doesn't say. */
		async modelName({ config, fetch, browser = false }) {
			const model = modelOf('claude', config);
			if (!claudeNames.has(model)) {
				const res = await fetch(`${ANTHROPIC}/models/${encodeURIComponent(model)}`, { headers: claudeHeaders(config, browser) });
				const data = res.ok ? await res.json() : null;
				if (!data?.display_name) return model;
				claudeNames.set(model, data.display_name);
			}
			return claudeNames.get(model);
		},
		async *stream({ config, system, messages, fetch, browser = false }) {
			const res = await fetch(`${ANTHROPIC}/messages`, {
				method: 'POST',
				headers: { ...claudeHeaders(config, browser), 'content-type': 'application/json', accept: 'text/event-stream' },
				body: JSON.stringify({ model: modelOf('claude', config), max_tokens: MAX_OUTPUT_TOKENS, system, messages, stream: true })
			});
			if (!res.ok) throw new Error(await apiError(res, 'Anthropic'));
			let input = 0;
			for await (const { event, data } of sseEvents(res)) {
				if (event === 'message_stop') return;
				let body;
				try {
					body = JSON.parse(data);
				} catch {
					continue;
				}
				if (event === 'error' || body?.type === 'error') {
					throw new Error(`Anthropic: ${body?.error?.message || 'the answer stopped'}`);
				}
				if (body?.type === 'content_block_delta' && body.delta?.type === 'text_delta' && body.delta.text) {
					yield body.delta.text;
				}
				if (body?.type === 'message_start') {
					const u = body.message?.usage;
					input = (u?.input_tokens || 0) + (u?.cache_read_input_tokens || 0) + (u?.cache_creation_input_tokens || 0);
				}
				if (body?.type === 'message_delta' && body.delta?.stop_reason === 'max_tokens') yield CUT_OFF;
				if (body?.type === 'message_delta' && body.usage) yield usage(input, body.usage.output_tokens);
			}
		}
	},
	openai: {
		async test({ config, fetch }) {
			if (!config?.key) return { ok: false, message: 'An API key is required' };
			const model = modelOf('openai', config);
			try {
				const models = await listOpenAiModels({ base: OPENAI, key: config.key, fetch, name: 'OpenAI' });
				if (!models.includes(model)) return { ok: false, message: `The key works, but it can’t use the model “${model}”` };
				return { ok: true, message: `Connected — answers come from ${model}` };
			} catch (err) {
				return { ok: false, message: `Connection failed: ${err.message}` };
			}
		},
		// OpenAI has no display names: the model id is the name.
		modelName: async ({ config }) => modelOf('openai', config),
		stream({ config, system, messages, fetch }) {
			return streamOpenAiChat({
				base: OPENAI,
				key: config.key,
				model: modelOf('openai', config),
				system,
				messages,
				fetch,
				name: 'OpenAI',
				extra: { max_completion_tokens: MAX_OUTPUT_TOKENS, stream_options: { include_usage: true } }
			});
		}
	}
};
