// The `health:` settings: the operator's status source at the top level, and
// each app's opt-in. Read once per config load; nothing here does I/O.
//
//   health:                       # optional; without it only `url` checks work
//     source: kener               # kener | uptime_kuma | gatus | cachet | http
//     url: https://status.example.com
//     api_key: ${KENER_API_KEY}
//     every: 60s
//     page: https://status.example.com   # optional: the public status page
//     show_source: false          # optional: no "Checked by …" line in the tip
//
//   apps:
//     - id: jellyfin
//       health: true              # the source's monitor for this app (URL, then name)
//     - id: cloud
//       health: nextcloud         # this monitor
//     - id: navidrome
//       health: { url: http://navidrome:4533/ping, every: 5m }   # Holm checks it

export const SOURCES = ['kener', 'uptime_kuma', 'gatus', 'cachet', 'http'];
export const MIN_EVERY = 30_000;
export const DEFAULT_EVERY = 60_000;

const show = (v) => JSON.stringify(v);
const isMapping = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isHttpUrl = (v) => {
	try {
		return typeof v === 'string' && ['http:', 'https:'].includes(new URL(v).protocol);
	} catch {
		return false;
	}
};

const UNITS = { s: 1000, m: 60_000, h: 3_600_000 };

/** `30s`, `5m`, `1h` (or a number of seconds) in ms; null when it isn't one. */
export function parseEvery(v) {
	if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v * 1000;
	const m = typeof v === 'string' && v.trim().match(/^(\d+)\s*([smh])$/);
	return m ? Number(m[1]) * UNITS[m[2]] : null;
}

function everyError(v, where) {
	if (v === undefined) return null;
	const ms = parseEvery(v);
	if (ms === null) return `${where} must be a time like 30s, 5m or 1h, not ${show(v)}`;
	if (ms < MIN_EVERY) return `${where} must be 30s or more, not ${show(v)}`;
	return null;
}

/** The top-level block as Holm uses it, or null when there's none. */
export function healthSource(config) {
	const h = config?.health;
	if (!isMapping(h)) return null;
	const source = h.source || 'http';
	return {
		source,
		url: typeof h.url === 'string' ? h.url.replace(/\/+$/, '') : null,
		apiKey: h.api_key || null,
		every: parseEvery(h.every) ?? DEFAULT_EVERY,
		page: typeof h.page === 'string' ? h.page.replace(/\/+$/, '') : null
	};
}

/**
 * What one app asked for: `{ monitor }` (a named monitor), `{ find: true }`
 * (the source's monitor for this app), `{ url }` (Holm checks it), each with
 * `every` in ms; or null for no dot.
 */
export function appHealth(app, source) {
	const h = app?.health;
	if (h === undefined || h === null || h === false) return null;
	const every = source?.every ?? DEFAULT_EVERY;
	if (h === true) return source && source.source !== 'http' ? { find: true, every } : { url: app.url, every };
	if (typeof h === 'string') return { monitor: h, every };
	if (h.enabled === false) return null;
	const own = parseEvery(h.every) ?? every;
	if (h.url) return { url: h.url, every: own };
	if (h.monitor) return { monitor: String(h.monitor), every: own };
	return appHealth({ ...app, health: true }, source && { ...source, every: own });
}

// Why one app's `health:` can't be used, or null.
function appError(app, source) {
	const h = app?.health;
	const name = `apps "${app?.id ?? app?.name}"`;
	if (h === undefined || h === null || typeof h === 'boolean') {
		if (h === true && (!source || source.source === 'http') && !isHttpUrl(app?.url)) {
			return `${name}: health: true checks the app's url, which isn't an http(s) URL`;
		}
		return null;
	}
	const needsSource = () => (!source || source.source === 'http' ? `${name}: health names a monitor, but health.source isn't a status source (kener, uptime_kuma, gatus or cachet)` : null);
	if (typeof h === 'string') return h.trim() ? needsSource() : `${name}: health must not be empty`;
	if (!isMapping(h)) return `${name}: health must be true, false, a monitor name or a mapping, not ${show(h)}`;
	for (const key of Object.keys(h)) {
		if (!['enabled', 'monitor', 'url', 'every'].includes(key)) return `${name}: health.${key} isn't a setting; use enabled, monitor, url or every`;
	}
	if (h.enabled !== undefined && typeof h.enabled !== 'boolean') return `${name}: health.enabled must be true or false`;
	if (h.monitor !== undefined && h.url !== undefined) return `${name}: health takes monitor or url, not both`;
	if (h.url !== undefined && !isHttpUrl(h.url)) return `${name}: health.url must be an http(s) URL, not ${show(h.url)}`;
	if (h.monitor !== undefined && (typeof h.monitor !== 'string' || !h.monitor.trim())) return `${name}: health.monitor must be a monitor name`;
	if (h.monitor !== undefined) return needsSource() || everyError(h.every, `${name}: health.every`);
	if (h.url === undefined && h.enabled !== false) return appError({ ...app, health: true }, source) || everyError(h.every, `${name}: health.every`);
	return everyError(h.every, `${name}: health.every`);
}

/** Why the config's health settings can't be used, or null when they can. */
export function healthError(config, apps = []) {
	const h = config?.health;
	if (h !== undefined && h !== null) {
		if (!isMapping(h)) return 'health must be a mapping';
		for (const key of Object.keys(h)) {
			if (!['source', 'url', 'api_key', 'every', 'page', 'show_source'].includes(key)) return `health.${key} isn't a setting; use source, url, api_key, every, page or show_source`;
		}
		const source = h.source ?? 'http';
		if (!SOURCES.includes(source)) return `health.source must be kener, uptime_kuma, gatus, cachet or http, not ${show(h.source)}`;
		if (source !== 'http') {
			if (!isHttpUrl(h.url)) return `health.url must be the http(s) address of ${source}, not ${show(h.url)}`;
			if (source === 'kener' && !h.api_key) return 'health.api_key is required for kener (Manage → API Keys)';
		} else if (h.url !== undefined || h.api_key !== undefined) {
			return 'health.url and health.api_key are for a status source; with source: http each app sets its own url';
		}
		if (h.show_source !== undefined && typeof h.show_source !== 'boolean') return 'health.show_source must be true or false';
		if (h.page !== undefined && !isHttpUrl(h.page)) return `health.page must be the http(s) address of your status page, not ${show(h.page)}`;
		const err = everyError(h.every, 'health.every');
		if (err) return err;
	}
	const source = healthSource(config);
	for (const app of apps) {
		const err = appError(app, source);
		if (err) return err;
	}
	return null;
}
