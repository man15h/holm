// Where an app's health comes from. Each source answers with the same shape:
//   { state, since?, detail? }
// state: up | slow | maintenance | down | failed (the check itself didn't work)
// `since` is when the state began, in ms, when the source knows it; with
// `longer`, it began before then and the source only looked back that far.

const TIMEOUT = 10_000;
const SLOW_MS = 3000;
// Kener's results older than this mean Kener has stopped checking.
const KENER_STALE = 30 * 60_000;

export const SOURCE_NAMES = { kener: 'Kener', uptime_kuma: 'Uptime Kuma', gatus: 'Gatus', cachet: 'Cachet', http: 'Holm' };

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

const IMPACT = { DOWN: 'down', DEGRADED: 'slow', MAINTENANCE: 'maintenance' };

/**
 * What Kener says is happening now, by monitor tag: `{ state, title, until? }`
 * from a maintenance under way, else from an incident not yet resolved.
 * One read of incidents and of active maintenances, then one of each
 * maintenance's events.
 */
export async function kenerNotices(fetch, source, now = Date.now()) {
	const auth = { authorization: `Bearer ${source.apiKey}` };
	const out = {};
	const incidents = (await (await get(fetch, `${source.url}/api/v4/incidents`, auth)).json())?.incidents;
	for (const i of Array.isArray(incidents) ? incidents : []) {
		if (i.state === 'RESOLVED' || (i.end_date_time && i.end_date_time * 1000 <= now)) continue;
		for (const { monitor_tag, impact = 'DOWN' } of i.monitors || []) {
			const state = IMPACT[impact];
			if (state) out[monitor_tag] = { state, title: i.title };
		}
	}
	const list = (await (await get(fetch, `${source.url}/api/v4/maintenances?status=ACTIVE`, auth)).json())?.maintenances;
	for (const m of Array.isArray(list) ? list : []) {
		if (m.status !== 'ACTIVE' || !m.monitors?.length) continue;
		const events = (await (await get(fetch, `${source.url}/api/v4/maintenances/${m.id}/events`, auth)).json())?.events || [];
		const live = events.find((e) => e.status === 'ONGOING' || (e.status !== 'CANCELLED' && e.status !== 'COMPLETED' && e.start_date_time * 1000 <= now && now < e.end_date_time * 1000));
		if (!live) continue;
		for (const { monitor_tag, impact } of m.monitors) {
			const state = IMPACT[impact];
			if (state) out[monitor_tag] = { state, title: m.title, until: live.end_date_time * 1000 };
		}
	}
	return out;
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

// --- Gatus (/api/v1/endpoints/statuses) --------------------------------------

// Gatus keeps the last results of every endpoint, oldest first, and doesn't
// say where it checks, so its endpoints match by name or key.
const GATUS_STALE = 30 * 60_000;

// Why a Gatus result failed: the HTTP status or the response time when that
// was the condition, else Gatus's error, else the condition as written.
function gatusWhy(r) {
	const failed = (r.conditionResults || []).filter((c) => !c.success).map((c) => c.condition);
	const status = failed.map((c) => c.match(/^\[STATUS\] \((\d+)\)/)).find(Boolean);
	if (status) return `answered ${status[1]}${REASONS[status[1]] ? ` ${REASONS[status[1]]}` : ''}`;
	const took = failed.map((c) => c.match(/^\[RESPONSE_TIME\] \((\d+)\)/)).find(Boolean);
	if (took) return `took ${(took[1] / 1000).toFixed(1)}s`;
	return r.errors?.[0] || failed[0];
}

function gatusState(results, now) {
	if (!results.length) return { state: 'failed', detail: 'Gatus has no results for it yet' };
	const last = results[results.length - 1];
	const at = (r) => Date.parse(r.timestamp);
	if (now - at(last) > GATUS_STALE) return { state: 'failed', detail: 'Gatus has no recent result' };
	// Only a response-time condition failing is slow, not down.
	const failed = (last.conditionResults || []).filter((c) => !c.success);
	const state = last.success ? 'up' : failed.length && failed.every((c) => c.condition.startsWith('[RESPONSE_TIME]')) ? 'slow' : 'down';
	let i = results.length - 1;
	while (i > 0 && results[i - 1].success === last.success) i--;
	return { state, since: at(results[i]), ...(i === 0 && { longer: true }), ...(state !== 'up' && { detail: gatusWhy(last) }) };
}

/** Every endpoint and its state from one read. `api_key` is `user:password` when Gatus asks for a login. */
export async function gatusMonitors(fetch, source, now = Date.now()) {
	const headers = source.apiKey ? { authorization: `Basic ${Buffer.from(source.apiKey).toString('base64')}` } : {};
	const data = await (await get(fetch, `${source.url}/api/v1/endpoints/statuses`, headers)).json();
	if (!Array.isArray(data)) throw new Error('unexpected reply from Gatus');
	return data.map((e) => ({ key: e.key, name: e.name, url: '', ...gatusState(e.results || [], now) }));
}

// --- Cachet (v3, /api/components) --------------------------------------------

// Component status: 1 operational, 2 performance issues, 3 partial outage,
// 4 major outage, 5 unknown, 6 under maintenance.
const CACHET_STATES = { 1: 'up', 2: 'slow', 3: 'slow', 4: 'down', 5: 'failed', 6: 'maintenance' };

/** Every enabled component and its status, its link as its URL. */
export async function cachetMonitors(fetch, source) {
	const headers = source.apiKey ? { authorization: `Bearer ${source.apiKey}` } : {};
	const monitors = [];
	for (let page = 1; page <= 20; page++) {
		const data = await (await get(fetch, `${source.url}/api/components?per_page=100&page=${page}`, { accept: 'application/json', ...headers })).json();
		if (!Array.isArray(data?.data)) throw new Error('unexpected reply from Cachet');
		for (const { id, attributes: a = {} } of data.data) {
			if (a.enabled === false) continue;
			const status = a.latest_status ?? a.status;
			const state = CACHET_STATES[status?.value] || 'failed';
			monitors.push({ key: String(id), name: a.name, url: a.link || '', state, ...(state !== 'up' && state !== 'maintenance' && status?.human && { detail: status.human }) });
		}
		if (!data.links?.next) break;
	}
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
