import { json } from '@sveltejs/kit';
import { getSessionUser } from '$lib/server/session.js';
import { getRegistry } from '$lib/server/integrations/index.js';
import { getConnection } from '$lib/server/integrations/store.js';
import { describeFetchError } from '$lib/server/integrations/deadline.js';
import { checkMessages, takeRateSlot, providerFetch, SYSTEM_PROMPT, CUT_OFF, callsInBrowser } from '$lib/server/integrations/ai.js';

// A local model can take a while to load before its first word, and a long
// answer streams for a while after; past this the answer is cut off.
const ANSWER_TIMEOUT_MS = 180000;

// POST /api/ai   body: { messages: [{ role, content }], integration? }
//
// Streams an answer from the user's own AI connection (Claude, OpenAI or a
// self-hosted server) as NDJSON lines: { "model": "…" } naming the model for the byline,
// { "text": "…" } per piece, then
// { "cutOff": true } if it hit the length limit, { "usage": { input, output } }
// in tokens if the API reports it, and { "done": true }, or
// { "error": "…" } if it stops partway. `integration`
// picks one of the user's AI connections; without it, the first connected.
// The model gets the conversation only: no tools, no Holm data. Nothing is
// stored, and closing the request (a new search, closing the chat) stops
// the upstream call.

export async function POST({ cookies, url, request }) {
	const user = getSessionUser(cookies, url);
	if (!user) return json({ error: 'Unauthorized' }, { status: 401 });

	let body;
	try {
		const text = await request.text();
		if (text.length > 65536) return json({ error: 'Payload too large' }, { status: 413 });
		body = JSON.parse(text);
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const checked = checkMessages(body?.messages);
	if (!checked.ok) return json({ error: checked.message }, { status: 400 });

	const wanted = typeof body?.integration === 'string' ? body.integration : null;
	// One set to `calls: browser` is the browser's to call, never the server's.
	const candidates = getRegistry().filter(({ adapter, operator }) => adapter.answers && !callsInBrowser(adapter, operator) && (!wanted || adapter.id === wanted));
	let adapter = null;
	let conn = null;
	for (const entry of candidates) {
		const c = await getConnection(user.username, entry.adapter.id);
		if (c?.connected) {
			adapter = entry.adapter;
			conn = c;
			break;
		}
	}
	if (!adapter) return json({ error: 'Connect Claude, OpenAI or a self-hosted AI under Configure → Integrations' }, { status: 409 });

	if (!takeRateSlot(user.username)) {
		return json({ error: 'That’s a lot of questions in a minute. Try again shortly.' }, { status: 429 });
	}

	const upstream = new AbortController();
	const deadlineFetch = providerFetch(ANSWER_TIMEOUT_MS, AbortSignal.any([request.signal, upstream.signal]));
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		// Not awaited: start() returning a promise could hold the first
		// pieces back until the whole answer is in.
		start(controller) {
			(async () => {
				// The browser may leave mid-answer; after that nothing is sent.
				const send = (obj) => {
					if (upstream.signal.aborted) return;
					try { controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n')); } catch {}
				};
				// The model's name comes alongside the answer, never holding it up.
				const named = adapter.answers.modelName
					? adapter.answers.modelName({ config: conn.config, fetch: providerFetch(5000) }).then((model) => model && send({ model }), () => {})
					: Promise.resolve();
				try {
					for await (const piece of adapter.answers.stream({ config: conn.config, system: SYSTEM_PROMPT, messages: checked.messages, fetch: deadlineFetch })) {
						if (upstream.signal.aborted || request.signal.aborted) break;
						send(piece === CUT_OFF ? { cutOff: true } : piece?.usage ? { usage: piece.usage } : { text: piece });
					}
					await named;
					send({ done: true });
				} catch (err) {
					if (!request.signal.aborted) send({ error: describeFetchError(err, ANSWER_TIMEOUT_MS) });
				} finally {
					try { controller.close(); } catch {}
				}
			})();
		},
		cancel() {
			upstream.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store',
			// Tells a proxy in front (nginx) not to hold the answer back until it's whole.
			'x-accel-buffering': 'no',
			'x-holm-ai': adapter.id
		}
	});
}
