// AI integrations the operator set to `calls: browser` (Claude, OpenAI): the
// user's key lives in this browser's localStorage only, and the browser calls
// the API itself with the same code the server uses (aiProviders.js). Holm's
// server never sees the key or the questions.

import { PROVIDERS, SYSTEM_PROMPT, CUT_OFF, checkMessages } from './aiProviders.js';

const TEST_TIMEOUT_MS = 8000;
const ANSWER_TIMEOUT_MS = 180000;

/** Who a browser-side call goes to, by integration id. */
export const NAMES = { claude: 'Anthropic', openai: 'OpenAI' };

// Per user, so two people sharing a browser don't share a key.
const storageKey = (user, id) => `holm.ai.${user}.${id}`;

/** The connection saved in this browser, or null. */
export function readLocal(user, id) {
	try {
		const config = JSON.parse(localStorage.getItem(storageKey(user, id)) || 'null');
		return config && typeof config === 'object' && config.key ? config : null;
	} catch {
		return null;
	}
}

export function writeLocal(user, id, config) {
	localStorage.setItem(storageKey(user, id), JSON.stringify(config));
}

export function clearLocal(user, id) {
	localStorage.removeItem(storageKey(user, id));
}

/** Forgets every AI key saved in this browser, for every user: on log out. */
export function clearAllLocal() {
	try {
		for (let i = localStorage.length - 1; i >= 0; i--) {
			const k = localStorage.key(i);
			if (k?.startsWith('holm.ai.')) localStorage.removeItem(k);
		}
	} catch {
		/* storage unavailable: nothing saved */
	}
}

// A fetch that gives up after `ms`, or when `signal` aborts.
function timed(ms, signal) {
	const signals = [AbortSignal.timeout(ms), ...(signal ? [signal] : [])];
	return (input, init = {}) => fetch(input, { ...init, signal: AbortSignal.any(signals) });
}

// A blocked or offline call is a bare TypeError ("Failed to fetch"): say where.
function reachError(id, err) {
	if (err?.name === 'TimeoutError') return `${NAMES[id]} didn’t answer in time`;
	if (err instanceof TypeError) return `This browser couldn’t reach ${NAMES[id]}`;
	return err?.message || String(err);
}

/** Tests a key from this browser: { ok, message }, as the server's test does. */
export async function testInBrowser(id, config) {
	const provider = PROVIDERS[id];
	if (!provider) return { ok: false, message: 'Unknown integration' };
	const result = await provider.test({ config, fetch: timed(TEST_TIMEOUT_MS), browser: true });
	// The providers turn a failed fetch into "Connection failed: Failed to fetch".
	if (!result.ok && /Failed to fetch|NetworkError|Load failed/.test(result.message)) {
		return { ok: false, message: reachError(id, new TypeError()) };
	}
	return result;
}

/**
 * Streams an answer straight from the API, with the same callbacks as
 * streamAnswer (aiAnswer.js). Throws with a message the card can show.
 */
export async function streamInBrowser({ integration, config, messages, signal, onText, onCutOff = () => {}, onModel = () => {}, onUsage = () => {} }) {
	const provider = PROVIDERS[integration];
	if (!provider || !config?.key) throw new Error('Connect this integration again: its key is not on this device');
	const checked = checkMessages(messages);
	if (!checked.ok) throw new Error(checked.message);
	try {
		const fetch = timed(ANSWER_TIMEOUT_MS, signal);
		provider.modelName({ config, fetch: timed(TEST_TIMEOUT_MS, signal), browser: true }).then(onModel, () => {});
		for await (const piece of provider.stream({ config, system: SYSTEM_PROMPT, messages: checked.messages, fetch, browser: true })) {
			if (signal?.aborted) return;
			if (piece === CUT_OFF) onCutOff();
			else if (piece?.usage) onUsage(piece.usage);
			else onText(piece);
		}
	} catch (err) {
		if (err?.name === 'AbortError' && signal?.aborted) throw err;
		throw new Error(reachError(integration, err));
	}
}
