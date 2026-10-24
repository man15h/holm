// Where an app's health comes from. Each source answers with the same shape:
//   { state, since?, detail? }
// state: up | slow | maintenance | down | failed (the check itself didn't work)
// `since` is when the state began, in ms, when the source knows it; with
// `longer`, it began before then and the source only looked back that far.

const TIMEOUT = 10_000;
const SLOW_MS = 3000;
// Kener's results older than this mean Kener has stopped checking.
const KENER_STALE = 30 * 60_000;

export const SOURCE_NAMES = { kener: 'Kener', uptime_kuma: 'Uptime Kuma', http: 'Holm' };

async function get(fetch, url, headers = {}) {
	const res = await fetch(url, { headers: { 'user-agent': 'Holm', ...headers }, signal: AbortSignal.timeout(TIMEOUT) });
	if (!res.ok) throw new Error(`answered ${res.status}`);
	return res;
}

const hostOf = (u) => {
	try {
		return new URL(u).hostname.toLowerCase();
	} catch {
		return '';
	}
};
const plain = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The monitor that stands for `app` among `monitors` ({ key, name, url }):
 * the first whose URL is on the app's host, else the first whose name or key
 * is the app's name or id.
 */
export function matchMonitor(app, monitors) {
	const host = hostOf(app.url);
	const byUrl = host && monitors.find((m) => hostOf(m.url) === host);
	if (byUrl) return byUrl;
	const names = new Set([plain(app.name), plain(app.id)].filter(Boolean));
	return monitors.find((m) => names.has(plain(m.name)) || names.has(plain(m.key))) || null;
}

/** A monitor named in config (`health: nextcloud`): by key, then by name. */
export function namedMonitor(name, monitors) {
	return monitors.find((m) => m.key === name) || monitors.find((m) => plain(m.name) === plain(name)) || null;
}

// --- Kener (v4 API) ---------------------------------------------------------

const KENER_STATES = { UP: 'up', DOWN: 'down', DEGRADED: 'slow', MAINTENANCE: 'maintenance' };

export async function kenerMonitors(fetch, source) {
	const res = await get(fetch, `${source.url}/api/v4/monitors?status=ACTIVE`, { authorization: `Bearer ${source.apiKey}` });
	const data = await res.json();
	if (!Array.isArray(data?.monitors)) throw new Error('unexpected reply from Kener');
	return data.monitors
		.filter((m) => m.status === 'ACTIVE')
		.map((m) => ({ key: m.tag, name: m.name, url: m.type_data?.url || m.external_url || '' }));
}

export async function kenerStatus(fetch, source, key, now = Date.now()) {
	const end = Math.floor(now / 1000);
	const url = `${source.url}/api/v4/monitors/${encodeURIComponent(key)}/data?start_ts=${end - 6 * 3600}&end_ts=${end}`;
	const res = await get(fetch, url, { authorization: `Bearer ${source.apiKey}` });
	const points = (await res.json())?.data;
	if (!Array.isArray(points) || !points.length) return { state: 'failed', detail: 'Kener has no results for it yet' };
	const last = points[points.length - 1];
	if (now - last.timestamp * 1000 > KENER_STALE) return { state: 'failed', detail: 'Kener has no recent result' };
	const state = KENER_STATES[last.status] || 'failed';
	// When this state began: the first of the unbroken run of it at the end.
	let i = points.length - 1;
	while (i > 0 && points[i - 1].status === last.status) i--;
	// The whole window in this state: it began before the window did.
	return { state, since: points[i].timestamp * 1000, ...(i === 0 && { longer: true }) };
}

// --- Uptime Kuma (/metrics, Prometheus text) ---------------------------------

const KUMA_STATES = { 0: 'down', 1: 'up', 2: 'slow', 3: 'maintenance' };

function labels(s) {
	const out = {};
	for (const [, k, v] of s.matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) out[k] = v.replace(/\\(.)/g, '$1');
	return out;
}

/** Every monitor and its state from one /metrics read. */
export async function kumaMonitors(fetch, source) {
	const auth = `Basic ${Buffer.from(`:${source.apiKey ?? ''}`).toString('base64')}`;
	const res = await get(fetch, `${source.url}/metrics`, source.apiKey ? { authorization: auth } : {});
	const text = await res.text();
	const monitors = [];
	for (const line of text.split('\n')) {
		const m = line.match(/^monitor_status\{(.*)\}\s+(\S+)/);
		if (!m) continue;
		const l = labels(m[1]);
		const url = l.monitor_url && l.monitor_url !== 'null' && l.monitor_url !== 'https://' ? l.monitor_url : l.monitor_hostname && l.monitor_hostname !== 'null' ? `http://${l.monitor_hostname}` : '';
		const state = KUMA_STATES[Number(m[2])] || 'failed';
		// 2 is PENDING: a check failed and Kuma is retrying before it calls it down.
		monitors.push({ key: l.monitor_id || l.monitor_name, name: l.monitor_name, url, state, detail: m[2] === '2' ? 'failing, being retried' : undefined });
	}
	if (!monitors.length && !text.includes('monitor_')) throw new Error('unexpected reply from Uptime Kuma');
	return monitors;
}

// --- Holm checks the URL itself -----------------------------------------------

const REASONS = { 400: 'Bad Request', 404: 'Not Found', 500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout' };

// Up: 2xx and redirects, a sign-in wall (401, 403), or busy (429). Anything
// else, a proxy's 404 for a missing route included, is down.
const isUp = (status) => (status >= 200 && status < 400) || [401, 403, 429].includes(status);

/** Up or down by the answer's status, with the status as the reason. */
export async function httpStatus(fetch, url, now = () => Date.now()) {
	const started = now();
	try {
		const res = await fetch(url, { headers: { 'user-agent': 'Holm' }, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
		await res.body?.cancel();
		if (!isUp(res.status)) return { state: 'down', detail: `answered ${res.status}${REASONS[res.status] ? ` ${REASONS[res.status]}` : ''}` };
		return { state: now() - started > SLOW_MS ? 'slow' : 'up' };
	} catch (err) {
		return { state: 'down', detail: err?.name === 'TimeoutError' ? `no answer within ${TIMEOUT / 1000}s` : 'no answer' };
	}
}
