// Thingport integration adapter.
//
// Surfaces:
//   - searchProviders.models      — 3D models, ranked by Thingport's own search
//   - searchProviders.collections — collections of models, from the same search
//   - searchProviders.tags        — tags with their model counts, from the same search
//
// All three providers read one GET /api/search response: holm queries each
// provider separately, so they share the in-flight request instead of
// searching three times. A read-only API token is all a search needs.

// holm shows six rows per section; one more says whether "More in Thingport"
// has anything to add. `limit` covers models and collections; Thingport
// returns at most five tags, so that section never offers "More".
const FETCH_LIMIT = 7;
// Long enough for the providers' requests for the same keystroke to land on
// one search; short enough that a model added in Thingport shows up next query.
const SHARED_SEARCH_TTL_MS = 5000;

// Image paths Thingport hands out for model thumbnails. The proxy only ever
// fetches these, so a crafted URL can't reach the rest of the API.
const IMAGE_PATH = /^(plate\/[A-Za-z0-9_-]+\/thumb\.jpg|preview-image\/[A-Za-z0-9_-]+\/file\.jpg)$/;

const searches = new Map(); // `${base}\n${token}\n${query}` → { promise, expiresAt }

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'thingport',
	name: 'Thingport',
	icon: 'di:thingport',
	shortcut: 'tp',
	description: '3D model library — search models, collections and tags',

	configSchema: [
		{
			key: 'url',
			type: 'url',
			label: 'Thingport URL',
			required: true,
			placeholder: 'https://thingport.example.com',
			help: 'Base URL of your Thingport server',
			fromOperatorDefault: 'default_url'
		},
		{
			key: 'token',
			type: 'secret',
			label: 'API Token',
			required: true,
			help: '1. Click your **avatar** (top right) → **Profile**\n2. Next to **API token**, click **Generate**\n3. Copy the token — it is only shown once',
			helpUrl: { baseKey: 'url', path: '/profile', label: 'Open Thingport profile' }
		}
	],

	async test({ config, fetch }) {
		if (!config?.url || !config?.token) {
			return { ok: false, message: 'URL and API token are required' };
		}
		const base = stripTrailingSlash(config.url);
		try {
			const res = await fetch(`${base}/api/dashboard/summary`, {
				method: 'GET',
				headers: authHeaders(config)
			});
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { ok: false, message: 'Token rejected — generate a new one under Profile → API token' };
				}
				return { ok: false, message: `Server returned ${res.status} ${res.statusText}` };
			}
			const data = await res.json();
			const count = data?.model_count ?? 0;
			return { ok: true, message: `Connected — ${count} model${count !== 1 ? 's' : ''} in library` };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	searchProviders: {
		models: {
			label: 'Models',
			mode: 'inline',
			async query({ config, query, fetch }) {
				const found = await search(config, query, fetch);
				if (!found) return { results: [] };
				const { base, data } = found;
				return {
					results: (data.models || []).map((model) => ({
						id: String(model.id),
						title: model.title || model.name || 'Untitled model',
						subtitle: model.category_name || '',
						thumbnail: thumbnailUrl(model),
						href: `${base}/models/${encodeURIComponent(model.id)}`,
						meta: { kind: 'model' }
					})),
					more: moreUrl(base, query)
				};
			}
		},
		collections: {
			label: 'Collections',
			mode: 'inline',
			async query({ config, query, fetch }) {
				const found = await search(config, query, fetch);
				if (!found) return { results: [] };
				const { base, data } = found;
				return {
					results: (data.collections || []).map((collection) => ({
						id: String(collection.id),
						title: collection.name || 'Untitled collection',
						subtitle: modelCount(collection.item_count),
						href: `${base}/models/collections/${encodeURIComponent(collection.id)}`,
						meta: { kind: 'collection' }
					})),
					more: moreUrl(base, query)
				};
			}
		},
		tags: {
			label: 'Tags',
			mode: 'inline',
			async query({ config, query, fetch }) {
				const found = await search(config, query, fetch);
				if (!found) return { results: [] };
				const { base, data } = found;
				return {
					results: (data.tags || []).filter((t) => t?.tag).map((t) => ({
						id: t.tag,
						title: t.tag,
						subtitle: modelCount(t.count),
						href: `${base}/models/tags/${encodeURIComponent(t.tag)}`,
						meta: { kind: 'tag' }
					}))
				};
			}
		}
	},

	proxy: {
		image: {
			defaultCacheControl: 'private, max-age=3600',
			async fetch({ config, params, fetch }) {
				const path = (params.path || []).join('/');
				if (!IMAGE_PATH.test(path)) return new Response('Invalid image path', { status: 400 });
				return fetch(`${stripTrailingSlash(config.url)}/api/${path}`, {
					method: 'GET',
					headers: authHeaders(config)
				});
			}
		}
	},

	widgets: {}
};

/** One GET /api/search per query, shared by all providers. Null for a blank query. */
async function search(config, query, fetch) {
	if (!config?.url || !config?.token) return null;
	const trimmed = (query || '').trim();
	if (!trimmed) return null;
	const base = stripTrailingSlash(config.url);

	const now = Date.now();
	for (const [key, entry] of searches) if (entry.expiresAt <= now) searches.delete(key);
	const key = `${base}\n${config.token}\n${trimmed}`;
	let entry = searches.get(key);
	if (!entry) {
		const params = new URLSearchParams({ q: trimmed, limit: String(FETCH_LIMIT) });
		const promise = fetch(`${base}/api/search?${params}`, { method: 'GET', headers: authHeaders(config) }).then(
			async (res) => {
				if (!res.ok) throw new Error(`Thingport search failed: ${res.status}`);
				return res.json();
			}
		);
		entry = { promise, expiresAt: now + SHARED_SEARCH_TTL_MS };
		searches.set(key, entry);
		// A failure isn't worth sharing: the next keystroke should try again.
		promise.catch(() => searches.delete(key));
	}
	return { base, data: await entry.promise };
}

// Thingport's full search results page, which reads `?q=` itself.
function moreUrl(base, query) {
	return `${base}/search-results?${new URLSearchParams({ q: (query || '').trim() })}`;
}

function modelCount(n) {
	const count = Number(n) || 0;
	return `${count} model${count !== 1 ? 's' : ''}`;
}

// Thingport's list rows use the first plate's render, falling back to the
// first gallery image. Both come as `/plate/…?v=…` paths; the `v` stays on so
// the browser refetches a re-rendered thumbnail.
function thumbnailUrl(model) {
	const raw = model.thumb_url || model.preview_images?.[0]?.url;
	if (!raw) return undefined;
	const [path, search] = raw.replace(/^\/+/, '').split('?');
	if (!IMAGE_PATH.test(path)) return undefined;
	return `/api/integrations/thingport/proxy/image/${path}${search ? `?${search}` : ''}`;
}

function stripTrailingSlash(url) {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

function authHeaders(config) {
	return {
		Authorization: `Bearer ${config.token}`,
		accept: 'application/json'
	};
}

export default adapter;
