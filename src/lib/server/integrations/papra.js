// Paperless-ngx integration adapter.
//
// Surfaces:
//   - searchProviders.documents — searches documents via full-text query API

/** @type {import('./_types.js').IntegrationAdapter} */
const adapter = {
	id: 'papra',
	name: 'Papra',
	icon: 'di:papra',
	shortcut: 'd',
	description: 'Document management with full-text search',

	configSchema: [
		{
			key: 'url',
			type: 'url',
			label: 'Papra URL',
			required: true,
			placeholder: 'https://papra.example.com',
			help: 'Base URL of your Papra server',
			fromOperatorDefault: 'default_url'
		},
		{
			key: 'token',
			type: 'secret',
			label: 'API Token',
			required: true,
			help: '1. Open **your User Account → API Keys**\n2. Click **Create API Key** and select only read permissions\n3. Click **Create API Key** and copy the value',
			helpUrl: { baseKey: 'url', path: '/api-keys', label: 'Open Papra settings' }
		},
		{
			key: 'organisation',
			type: 'text',
			label: 'Organisation ID',
			required: true,
			help: '1. In Papra URL copy the **org_ value**',
		}
	],

	async test({ config, fetch }) {
		if (!config?.url || !config?.token || !config?.organisation) {
			return { ok: false, message: 'URL, token, and organisation are required' };
		}
		const base = stripTrailingSlash(config.url);
		try {
			const res = await fetch(`${base}/api/organizations/${config.organisation}/documents/statistics`, {
				method: 'GET',
				headers: authHeaders(config)
			});
			if (!res.ok) {
				if (res.status === 401 || res.status === 403) {
					return { ok: false, message: 'Token rejected — check that it is a valid API token' };
				}
				return { ok: false, message: `Server returned ${res.status} ${res.statusText}` };
			}
			const data = await res.json();
			const count = data?.organizationStats?.documentsCount ?? 0;
			return { ok: true, message: `Connected — ${count} document${count !== 1 ? 's' : ''} in library` };
		} catch (err) {
			return { ok: false, message: `Connection failed: ${err.message}` };
		}
	},

	searchProviders: {
		documents: {
			label: 'Documents',
			mode: 'inline',
			async query({ config, query, limit, fetch }) {
				if (!config?.url || !config?.token || !config?.organisation) return { results: [] };
				const trimmed = (query || '').trim();
				if (!trimmed) return { results: [] };

				const base = stripTrailingSlash(config.url);
				const params = new URLSearchParams({
					pageIndex: '0',
					pageSize: String(Math.min(limit || 10, 25)),
					searchQuery: `content:${trimmed} OR name:${trimmed}*`
				});
				const res = await fetch(`${base}/api/organizations/${config.organisation}/documents?${params}`, {
					method: 'GET',
					headers: authHeaders(config)
				});
				if (!res.ok) {
					throw new Error(`Papra search failed: ${res.status}`);
				}
				const data = await res.json();
				console.log('Papra search results:', data);
				const items = data?.documents || [];
				return {
					results: items.map((doc) => ({
						id: String(doc.id),
						title: doc.name || `Document #${doc.id}`,
						subtitle: '',
						thumbnail: '',
						href: `${base}/organizations/${config.organisation}/documents/${doc.id}`,
						meta: { kind: 'document' }
					}))
				};
			}
		}
	},

	proxy: {
		thumbnail: {
			defaultCacheControl: 'private, max-age=3600',
			async fetch({ config, params, fetch }) {
				const base = stripTrailingSlash(config.url);
				const id = params.path?.[0];
				if (!id) return new Response('Missing document id', { status: 400 });
				return fetch(`${base}/api/documents/${encodeURIComponent(id)}/thumb/`, {
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

function authHeaders(config) {
	return {
		Authorization: `Bearer ${config.token}`,
		accept: 'application/json'
	};
}

export default adapter;
