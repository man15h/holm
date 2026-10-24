import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { readLocal, writeLocal, clearLocal, testInBrowser } from '$lib/aiCalls.js';

// Client-side cache of /api/integrations.
//
// Lazy: nothing fetched until something calls `load()` (typically the first
// time the Integrations tab opens). Result is cached in-memory; calls during
// in-flight loads share the same promise.
//
// An integration with `calls: browser` (Claude, OpenAI) is connected in this
// browser instead: save, test and disconnect keep its key in localStorage
// (aiCalls.js), and it never goes to Holm's server.

// What the server shows for a saved secret (serialize.js), so the form
// sends it back unchanged.
const REDACTED = '••••••••';

const inBrowser = (it) => it?.calls === 'browser';

// The form's fields over what this browser has saved, as the server merges.
function mergeLocal(it, stored, submitted = {}) {
	const out = { ...stored };
	for (const field of it.configSchema || []) {
		const v = submitted[field.key];
		if (v == null) continue;
		if (field.type === 'secret' && v === REDACTED) continue;
		const value = typeof v === 'string' ? v.trim() : v;
		if (value === '') delete out[field.key];
		else out[field.key] = value;
	}
	return out;
}

function localUserState(it, config) {
	if (!config) return { connected: false, config: {}, surfaces: {} };
	const secret = new Set((it.configSchema || []).filter((f) => f.type === 'secret').map((f) => f.key));
	return {
		connected: true,
		config: Object.fromEntries(Object.entries(config).map(([k, v]) => [k, secret.has(k) ? REDACTED : v])),
		surfaces: {}
	};
}

function createIntegrationsStore() {
	const state = writable({ loaded: false, loading: false, error: '', integrations: [] });
	let inflight = null;
	// The signed-in user, from /api/integrations: browser-side keys are kept per user.
	let user = null;

	const find = (id) => get(state).integrations.find((it) => it.id === id);
	const patch = (id, userState) =>
		state.update((s) => ({
			...s,
			integrations: s.integrations.map((it) => (it.id === id ? { ...it, userState } : it))
		}));

	async function fetchAndSet() {
		try {
			const res = await fetch('/api/integrations');
			// No session (auth disabled): there are simply no integrations.
			if (res.status === 401) {
				state.set({ loaded: true, loading: false, error: '', integrations: [] });
				return;
			}
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = await res.json();
			user = data.user || null;
			const list = (data.integrations || []).map((it) =>
				inBrowser(it) ? { ...it, userState: localUserState(it, readLocal(user, it.id)) } : it
			);
			state.set({ loaded: true, loading: false, error: '', integrations: list });
		} catch (err) {
			console.error('[integrations] fetch failed:', err);
			// loaded stays false so the next load() retries instead of caching the failure
			state.set({ loaded: false, loading: false, error: err.message || 'Failed to load', integrations: [] });
		} finally {
			inflight = null;
		}
	}

	async function load({ force = false } = {}) {
		if (!browser) return;
		const cur = get(state);
		if (cur.loaded && !force) return;
		if (inflight) return inflight;
		state.update((s) => ({ ...s, loading: true }));
		inflight = fetchAndSet();
		return inflight;
	}

	async function save(integrationId, payload) {
		const local = find(integrationId);
		if (inBrowser(local)) {
			const config = mergeLocal(local, readLocal(user, integrationId) || {}, payload?.config);
			const missing = (local.configSchema || []).find((f) => f.required && !config[f.key]);
			if (missing) throw new Error(`${missing.label} is required`);
			writeLocal(user, integrationId, config);
			const userState = localUserState(local, config);
			patch(integrationId, userState);
			return { ok: true, userState };
		}
		const wasConnected = !!get(state).integrations.find((it) => it.id === integrationId)?.userState?.connected;
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}`, {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			throw new Error(err.error || `Save failed (${res.status})`);
		}
		const data = await res.json();
		// Patch the cached entry in place.
		state.update((s) => ({
			...s,
			integrations: s.integrations.map((it) =>
				it.id === integrationId ? { ...it, userState: data.userState } : it
			)
		}));
		// A new connection can connect others too (Jellyfin → Seerr).
		if (!wasConnected) load({ force: true });
		return data;
	}

	async function disconnect(integrationId) {
		if (inBrowser(find(integrationId))) {
			clearLocal(user, integrationId);
			patch(integrationId, localUserState(null, null));
			// Also drops a key saved on the server before the operator switched.
			await fetch(`/api/integrations/${encodeURIComponent(integrationId)}`, { method: 'DELETE' }).catch(() => {});
			return;
		}
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}`, { method: 'DELETE' });
		if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
		state.update((s) => ({
			...s,
			integrations: s.integrations.map((it) =>
				it.id === integrationId
					? { ...it, userState: { connected: false, config: {}, surfaces: {} } }
					: it
			)
		}));
		// Disconnecting Jellyfin also disconnects a Seerr linked through it.
		load({ force: true });
	}

	// `account` tests another account of a Calendar: its id, or 'new'.
	async function test(integrationId, config, account) {
		const local = find(integrationId);
		if (inBrowser(local)) return testInBrowser(integrationId, mergeLocal(local, readLocal(user, integrationId) || {}, config));
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/test`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(account ? { config, account } : { config })
		});
		if (!res.ok) {
			const err = await res.json().catch(() => ({}));
			return { ok: false, message: err.error || `HTTP ${res.status}` };
		}
		return await res.json();
	}

	// Sign-in flows (e.g. Jellyfin Quick Connect): start returns a code to
	// show; poll until the server reports done, which also saves the
	// connection server-side.
	async function signIn(integrationId, body) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/signin`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(data.error || `Sign-in failed (${res.status})`);
		if (data.status === 'done') {
			state.update((s) => ({
				...s,
				integrations: s.integrations.map((it) =>
					it.id === integrationId ? { ...it, userState: data.userState } : it
				)
			}));
			// One sign-in can connect others too (Jellyfin → Seerr).
			load({ force: true });
		}
		return data;
	}

	// Runs an adapter action for a search result (e.g. Seerr's Request).
	async function runAction(integrationId, key, params) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/action/${encodeURIComponent(key)}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ params })
		});
		const data = await res.json().catch(() => ({}));
		return { ok: !!data.ok, message: data.message || data.error || `HTTP ${res.status}` };
	}

	// Detail view for a search result that carries `detail` params.
	async function details(integrationId, params) {
		const res = await fetch(`/api/integrations/${encodeURIComponent(integrationId)}/details`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ params })
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data.details) throw new Error(data.error || `HTTP ${res.status}`);
		return data.details;
	}

	// The key and settings of a `calls: browser` integration, for its answers.
	function browserConfig(integrationId) {
		return readLocal(user, integrationId);
	}

	return {
		subscribe: state.subscribe,
		browserConfig,
		load,
		save,
		disconnect,
		test,
		signIn,
		runAction,
		details
	};
}

export const integrations = createIntegrationsStore();
