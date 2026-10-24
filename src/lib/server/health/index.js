// App health for the tiles. Holm's server does every check and keeps the
// answer in memory, so one check per `every` serves everyone, however many are
// looking. A request never waits for a check: it gets the last answer, and a
// check that is due starts in the background (as updateCheck.js does).

import { appHealth } from './config.js';
import { SOURCE_NAMES, kenerMonitors, kenerStatus, kumaMonitors, httpStatus, matchMonitor, namedMonitor } from './sources.js';

// The monitor list changes rarely; Kener's is read at most this often.
const LIST_EVERY = 10 * 60_000;

const entries = new Map();
const warned = new Set();

// The value under `key`, starting `load` when it's older than `every`.
function cached(key, every, load, now) {
	let e = entries.get(key);
	if (!e) entries.set(key, (e = { at: -Infinity, value: null, pending: null }));
	if (now - e.at >= every && !e.pending) {
		e.pending = load()
			.catch((err) => ({ error: err?.name === 'TimeoutError' ? 'no answer' : err?.message || String(err) }))
			.then((value) => {
				// Keep `since` across checks when the source doesn't say.
				if (value.state && value.since === undefined && e.value?.state) {
					value.since = e.value.state === value.state ? e.value.since : now;
				}
				Object.assign(e, { at: now, value, pending: null });
			});
	}
	return e.value;
}

// "Kener didn't answer", "Kener answered 401", or the error as it is.
function trouble(by, error) {
	if (error === 'no answer') return `${by} didn't answer`;
	return error.startsWith('answered ') ? `${by} ${error}` : error;
}

function warnOnce(key, message) {
	if (warned.has(key)) return;
	warned.add(key);
	console.warn(`[holm] health: ${message}`);
}

function monitorFor(app, plan, list, source) {
	const monitor = plan.monitor ? namedMonitor(plan.monitor, list) : matchMonitor(app, list);
	if (!monitor) {
		const what = plan.monitor ? `no ${SOURCE_NAMES[source.source]} monitor is called "${plan.monitor}"` : `no ${SOURCE_NAMES[source.source]} monitor has its URL or name`;
		warnOnce(`${app.id}:${plan.monitor ?? ''}`, `apps "${app.id}": ${what}; it gets no dot`);
	}
	return monitor;
}

/**
 * `{ [app id]: { state, since?, detail?, source } }` for those of `apps` with a
 * check and an answer so far. `source` names who checked: Kener, Uptime Kuma
 * or Holm.
 */
export function healthFor(apps, source, { fetch = globalThis.fetch, now = Date.now() } = {}) {
	const out = {};
	for (const app of apps) {
		const plan = appHealth(app, source);
		if (!plan || !app.id) continue;
		let value;
		let by = 'Holm';
		if (plan.url) {
			value = cached(`url:${plan.url}`, plan.every, () => httpStatus(fetch, plan.url), now);
		} else if (source.source === 'kener') {
			by = 'Kener';
			const list = cached('kener:list', Math.max(LIST_EVERY, source.every), () => kenerMonitors(fetch, source), now);
			if (list?.error) value = { state: 'failed', detail: trouble('Kener', list.error) };
			else if (list) {
				const monitor = monitorFor(app, plan, list, source);
				if (monitor) value = cached(`kener:${monitor.key}`, plan.every, () => kenerStatus(fetch, source, monitor.key, now), now);
				// Kener's API says a monitor is down but not why; the monitor's
				// description is where the operator can say.
				if (monitor?.description && value?.state && value.state !== 'up' && !value.detail) value = { ...value, detail: monitor.description };
			}
		} else {
			by = 'Uptime Kuma';
			const list = cached('kuma:list', source.every, () => kumaMonitors(fetch, source), now);
			if (list?.error) value = { state: 'failed', detail: trouble('Uptime Kuma', list.error) };
			else if (list) {
				const monitor = monitorFor(app, plan, list, source);
				if (monitor) value = { state: monitor.state, detail: monitor.detail };
			}
		}
		if (value?.error) value = { state: 'failed', detail: trouble(by, value.error) };
		if (value) out[app.id] = { ...value, source: by };
	}
	return out;
}

/** Resolves once every check in progress has finished. */
export async function healthSettled() {
	while ([...entries.values()].some((e) => e.pending)) {
		await Promise.all([...entries.values()].map((e) => e.pending));
	}
}

/** For tests: forget every answer and warning. */
export function resetHealth() {
	entries.clear();
	warned.clear();
}
