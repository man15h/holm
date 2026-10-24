// The server's side of the AI integrations: a per-user rate limit, and the
// shared calls (src/lib/aiProviders.js) for the adapters and POST /api/ai.

export * from '../../aiProviders.js';
import { withDeadline } from './deadline.js';

/**
 * The fetch for an AI provider's calls: the platform's own, with a deadline.
 * Not SvelteKit's event fetch, which adds `Origin: <Holm's URL>` to every
 * cross-site call; Anthropic takes that for a browser and refuses the call,
 * and neither API needs to learn Holm's address.
 */
export function providerFetch(ms, signal) {
	return withDeadline((input, init) => globalThis.fetch(input, init), ms, signal);
}

/**
 * True for an integration that supports it (Claude, OpenAI) unless the
 * operator set `calls: server`: the user's key then stays in their browser,
 * which calls the API itself, and Holm's server never holds or uses it.
 */
export function callsInBrowser(adapter, operator) {
	return !!adapter?.browserCalls && operator?.calls !== 'server';
}

// A sliding window per user. In memory: a restart forgets it, which is fine
// for a guard against runaway loops on the user's own key.
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const recent = new Map(); // username → timestamps (ms) of asks inside the window

/** Records an ask; false when the user already made RATE_LIMIT in the last minute. */
export function takeRateSlot(username, now = Date.now()) {
	const kept = (recent.get(username) || []).filter((t) => now - t < RATE_WINDOW_MS);
	if (kept.length >= RATE_LIMIT) {
		recent.set(username, kept);
		return false;
	}
	kept.push(now);
	recent.set(username, kept);
	return true;
}

export function resetRateLimits() {
	recent.clear();
}
