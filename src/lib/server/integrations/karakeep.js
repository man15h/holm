// Karakeep integration adapter.
//
// Surfaces:
//   - searchProviders.bookmarks — searches bookmarks via full-text search API;
//     a tag or list filter is sent as Karakeep's own `#"tag"` / `list:"name"`
//   - searchProviders.tags, .lists — only under !b: picking one searches
//     inside it

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'karakeep',
	name: 'Karakeep',
	icon: 'di:karakeep',
	shortcut: 'b',
	description: 'Bookmark manager with full-text search',

	configSchema: [
		{
			key: 'url',
			type: 'url',
			label: 'Karakeep URL',
			required: true,
			placeholder: 'https://karakeep.example.com',
			help: 'Base URL of your Karakeep server',
			fromOperatorDefault: 'default_url'
		},
		{
			key: 'apiKey',
			type: 'secret',
			label: 'API Key',
			required: true,
			help: '1. Click your **user icon** (top right) → **Settings**\n2. Scroll to **API Keys**\n3. Click **New API Key**, name it, and copy the value',
			helpUrl: { baseKey: 'url', path: '/settings/api-keys', label: 'Open Karakeep settings' }
		}
	],

	async test({ config, fetch }) {
		if (!config?.url || !config?.apiKey) {
			return { ok: false, message: 'URL and API key are required' };
		}
		const base = stripTrailingSlash(config.url);
		try {
			const res = await fetch(`${base}/api/v1/bookmarks?limit=1`, {
				method: 'GET',
				headers: authHeaders(config)
			});
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { ok: false, message: 'API key rejected — check that it is valid' };
				}
				return { ok: false, message: `Server returned ${res.status} ${res.statusText}` };
			}
			const data = await res.json();
			// Karakeep doesn't return a total count in list responses,
			// so we just confirm the connection works
			const hasBookmarks = (data?.bookmarks || []).length > 0;
			return { ok: true, message: hasBookmarks ? 'Connected — bookmarks found' : 'Connected — no bookmarks yet' };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	searchProviders: {
		bookmarks: {
			label: 'Bookmarks',
			mode: 'inline',
			filters: true,
			async query({ config, query, limit, fetch, filter }) {
				if (!config?.url || !config?.apiKey) return { results: [] };
				const scope = filterQuery(filter);
				if (scope === null) return { results: [] };
				const trimmed = [scope, (query || '').trim()].filter(Boolean).join(' ');
				if (!trimmed) return { results: [] };

				const base = stripTrailingSlash(config.url);
				const params = new URLSearchParams({
					q: trimmed,
					limit: String(Math.min(limit || 10, 25))
				});
				const res = await fetch(`${base}/api/v1/bookmarks/search?${params}`, {
					method: 'GET',
					headers: authHeaders(config)
				});
				if (!res.ok) {
					throw new Error(`Karakeep search failed: ${res.status}`);
				}
				const data = await res.json();
				const items = data?.bookmarks || [];
				return {
					results: items.map((bm) => {
						const content = bm.content || {};
						const isLink = content.type === 'link';
						const title = (isLink ? content.title : null) || bm.title || 'Untitled';
						const tags = (bm.tags || []).map((t) => t.name).filter(Boolean);
						const subtitle = tags.length
							? tags.join(', ')
							: (isLink ? content.description : null) || '';
						return {
							id: String(bm.id),
							title,
							subtitle: subtitle.slice(0, 120),
							thumbnail: `/api/integrations/karakeep/proxy/screenshot/${bm.id}`,
							href: isLink ? content.url : `${base}/dashboard/preview/${bm.id}`,
							meta: { kind: 'bookmark' }
						};
					}),
					more: `${base}/dashboard/search?${new URLSearchParams({ q: trimmed })}`
				};
			}
		},
		tags: {
			label: 'Tags',
			mode: 'inline',
			scoped: true,
			async query({ config, query, limit, fetch }) {
				const needle = (query || '').trim().toLowerCase();
				if (!config?.url || !config?.apiKey || !needle) return { results: [] };
				const base = stripTrailingSlash(config.url);
				// Older Karakeeps ignore nameContains and send every tag, so
				// the match is checked here too.
				const params = new URLSearchParams({ nameContains: needle, sort: 'usage' });
				const res = await fetch(`${base}/api/v1/tags?${params}`, { method: 'GET', headers: authHeaders(config) });
				if (!res.ok) throw new Error(`Karakeep tags failed: ${res.status}`);
				const data = await res.json();
				return {
					results: (data?.tags || [])
						.filter((t) => filterable(t?.name) && t.name.toLowerCase().includes(needle))
						.sort((a, b) => (b.numBookmarks || 0) - (a.numBookmarks || 0))
						.slice(0, Math.min(limit || 10, 25))
						.map((t) => ({
							id: String(t.id),
							title: `#${t.name}`,
							subtitle: bookmarkCount(t.numBookmarks),
							href: `${base}/dashboard/tags/${encodeURIComponent(t.id)}`,
							filter: { label: `#${t.name}`, params: { tag: t.name } },
							meta: { kind: 'tag' }
						}))
				};
			}
		},
		lists: {
			label: 'Lists',
			mode: 'inline',
			scoped: true,
			async query({ config, query, limit, fetch }) {
				const needle = (query || '').trim().toLowerCase();
				if (!config?.url || !config?.apiKey || !needle) return { results: [] };
				const base = stripTrailingSlash(config.url);
				const res = await fetch(`${base}/api/v1/lists`, { method: 'GET', headers: authHeaders(config) });
				if (!res.ok) throw new Error(`Karakeep lists failed: ${res.status}`);
				const data = await res.json();
				return {
					results: (data?.lists || [])
						// list:"name" only finds the user's own lists, not ones shared with them.
						.filter((l) => filterable(l?.name) && (!l.userRole || l.userRole === 'owner') && l.name.toLowerCase().includes(needle))
						.slice(0, Math.min(limit || 10, 25))
						.map((l) => ({
							id: String(l.id),
							title: l.icon ? `${l.icon} ${l.name}` : l.name,
							subtitle: l.type === 'smart' ? 'Smart list' : 'List',
							href: `${base}/dashboard/lists/${encodeURIComponent(l.id)}`,
							filter: { label: l.name, params: { list: l.name } },
							meta: { kind: 'collection' }
						}))
				};
			}
		}
	},

	proxy: {
		screenshot: {
			defaultCacheControl: 'private, max-age=3600',
			async fetch({ config, params, fetch }) {
				const base = stripTrailingSlash(config.url);
				const id = params.path?.[0];
				if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
					return new Response('Invalid bookmark id', { status: 400 });
				}
				return fetch(`${base}/api/v1/bookmarks/${id}/assets/screenshot`, {
					method: 'GET',
					headers: authHeaders(config)
				});
			}
		}
	},

	widgets: {}
};

function stripTrailingSlash(url) {
	return url.endsWith('/') ? url.slice(0, -1) : url;
}

// Karakeep's query language quotes a name but can't escape a quote in it,
// so those tags and lists aren't offered as filters.
function filterable(name) {
	return typeof name === 'string' && name.length > 0 && name.length <= 200 && !name.includes('"');
}

// The filter from a picked tag or list as Karakeep search syntax: '' for
// none, null when it isn't one this adapter made.
function filterQuery(filter) {
	if (!filter) return '';
	if (filterable(filter.tag)) return `#"${filter.tag}"`;
	if (filterable(filter.list)) return `list:"${filter.list}"`;
	return null;
}

function bookmarkCount(n) {
	const count = Number(n) || 0;
	return `${count} bookmark${count === 1 ? '' : 's'}`;
}

function authHeaders(config) {
	return {
		Authorization: `Bearer ${config.apiKey}`,
		accept: 'application/json'
	};
}

export default adapter;
