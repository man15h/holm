// Emoji search for the launcher: ":fire" or "fire emoji". The data is
// Emojibase's English set with GitHub shortcodes, loaded on first use so
// it stays out of the main bundle.

// Emojibase groups: 2 is skin tones and hair parts, which aren't emoji you'd
// send on their own; regional indicator letters have no group.
const SKIP_GROUP = 2;

let loading;

export function loadEmoji() {
	loading ??= Promise.all([
		import('emojibase-data/en/compact.json'),
		import('emojibase-data/en/shortcodes/github.json')
	])
		.then(([data, codes]) => buildIndex(data.default, codes.default))
		.catch((err) => {
			loading = null;
			throw err;
		});
	return loading;
}

// → [{ emoji, name, codes: [shortcode], tags: [tag] }] in Emojibase order.
export function buildIndex(data, shortcodes = {}) {
	return data
		.filter((e) => e.group !== undefined && e.group !== SKIP_GROUP)
		.map((e) => {
			const sc = shortcodes[e.hexcode];
			return {
				emoji: e.unicode,
				name: e.label,
				codes: sc ? (Array.isArray(sc) ? sc : [sc]) : [],
				tags: e.tags || []
			};
		});
}

// Best matches first: shortcode or name, then a word of the name, then a
// tag. Ties keep Emojibase's order, which puts the common faces first.
export function searchEmoji(index, query, limit = 48) {
	const q = (query || '').trim().toLowerCase().replace(/^:|:$/g, '');
	if (!q) return index.slice(0, limit);
	const scored = [];
	for (let i = 0; i < index.length; i++) {
		const s = score(index[i], q);
		if (s) scored.push({ s, i });
	}
	scored.sort((a, b) => b.s - a.s || a.i - b.i);
	return scored.slice(0, limit).map((x) => index[x.i]);
}

function score(e, q) {
	if (e.codes.includes(q) || e.name === q) return 100;
	if (e.name.startsWith(q)) return 90;
	if (e.codes.some((c) => c.startsWith(q))) return 85;
	if (e.name.split(/[\s:,-]+/).some((w) => w.startsWith(q))) return 80;
	if (e.tags.includes(q)) return 70;
	if (e.tags.some((t) => t.startsWith(q))) return 60;
	if (q.length >= 3 && e.name.includes(q)) return 40;
	return 0;
}

// ":fire", ":+1:", "fire emoji", "emoji fire" → the search term, else null.
// A lone ":" opens the picker with nothing typed yet.
export function emojiQuery(query) {
	const q = (query || '').trim();
	let m = q.match(/^:([^\s:]{0,40}):?$/);
	if (m) return { term: m[1], only: true };
	m = q.match(/^(?:emoji\s+(.+)|(.+?)\s+emoji)$/i);
	if (m) return { term: (m[1] || m[2]).trim(), only: false };
	return null;
}
