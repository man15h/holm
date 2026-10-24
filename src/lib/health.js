// The words for an app's health, shared by the tile's hover tip, its menu
// and its aria-label. `h` is one app's entry from /api/health; up (or none)
// has no words, because a tile that works says nothing.

const STATES = {
	down: { tone: 'down', is: 'is down', short: 'down' },
	slow: { tone: 'slow', is: 'is slow', short: 'slow' },
	maintenance: { tone: 'slow', is: 'is under maintenance', short: 'under maintenance' },
	failed: { tone: 'failed', is: null, short: 'status unknown' }
};

/** `12 min`, `3 h`, `2 days`. */
export function duration(ms) {
	const min = Math.round(ms / 60_000);
	if (min < 1) return 'under a minute';
	if (min < 60) return `${min} min`;
	const h = Math.round(min / 60);
	if (h < 48) return `${h} h`;
	return `${Math.round(h / 24)} days`;
}

/**
 * `{ tone, title, rest, note, by, link }` for a tile that isn't up, else
 * null. tone is down | slow | failed; `rest` is the muted part; `note` is the
 * status page's own words on it; `by` says who checked; `link` is the status
 * page for it, when the operator set one.
 */
export function healthLine(app, h, now = Date.now()) {
	const s = h && STATES[h.state];
	if (!s) return null;
	const rest = [];
	if (s.is && h.since) rest.push(`for ${h.longer ? 'over ' : ''}${duration(now - h.since)}`);
	if (h.detail) rest.push(h.detail);
	if (h.until) rest.push(`until ${new Date(h.until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`);
	return { tone: s.tone, title: s.is ? `${app.name} ${s.is}` : 'Status unknown', rest: rest.join(' · '), note: h.note || '', by: s.is ? `Checked by ${h.source}` : '', link: h.link || null };
}

/** `Cloud, down`; just the name when it's up or unchecked. */
export function healthLabel(app, h) {
	const s = h && STATES[h.state];
	return s ? `${app.name}, ${s.short}` : app.name;
}
