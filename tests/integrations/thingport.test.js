// Unit tests for src/lib/server/integrations/thingport.js: the three search
// sections share one request, "More" opens Thingport's results page, and the
// image proxy only fetches thumbnail paths.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import thingport from '../../src/lib/server/integrations/thingport.js';

const config = { url: 'https://tp.example.com/', token: 'tok' };
const response = {
	models: [
		{ id: 'm1', title: 'Benchy', category_name: 'Test prints', thumb_url: '/plate/p1/thumb.jpg?v=123' },
		{ id: 'm2', name: 'Clip', preview_images: [{ url: '/preview-image/i1/file.jpg' }] },
		{ id: 'm3', name: 'Odd', thumb_url: '/profile/avatar.png' }
	],
	has_more_models: false,
	collections: [{ id: 'c1', name: 'Boats', item_count: 1 }],
	tags: [{ tag: 'boat hull', count: 3 }]
};

function fakeFetch() {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url, init });
		return new Response(JSON.stringify(response), { headers: { 'content-type': 'application/json' } });
	};
	return { fetch, calls };
}

const run = (key, query, fetch) => thingport.searchProviders[key].query({ config, query, limit: 24, fetch });

test('models, collections and tags map to Thingport links, from one request', async () => {
	const { fetch, calls } = fakeFetch();
	const query = `benchy ${Date.now()}`;
	const [models, collections, tags] = await Promise.all(['models', 'collections', 'tags'].map((k) => run(k, query, fetch)));

	assert.equal(calls.length, 1);
	const sent = new URL(calls[0].url);
	assert.equal(sent.origin + sent.pathname, 'https://tp.example.com/api/search');
	assert.equal(sent.searchParams.get('q'), query);
	assert.equal(sent.searchParams.get('limit'), '7');
	assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');

	assert.deepEqual(models.results.map((r) => [r.title, r.subtitle, r.href, r.thumbnail]), [
		['Benchy', 'Test prints', 'https://tp.example.com/models/m1', '/api/integrations/thingport/proxy/image/plate/p1/thumb.jpg?v=123'],
		['Clip', '', 'https://tp.example.com/models/m2', '/api/integrations/thingport/proxy/image/preview-image/i1/file.jpg'],
		['Odd', '', 'https://tp.example.com/models/m3', undefined]
	]);
	assert.deepEqual(collections.results.map((r) => [r.title, r.subtitle, r.href]), [
		['Boats', '1 model', 'https://tp.example.com/models/collections/c1']
	]);
	assert.deepEqual(tags.results.map((r) => [r.title, r.subtitle, r.href]), [
		['boat hull', '3 models', 'https://tp.example.com/models/tags/boat%20hull']
	]);
});

test('"More" opens Thingport\'s results page for the query', async () => {
	const { fetch } = fakeFetch();
	const out = await run('models', ' gear box ', fetch);
	assert.equal(out.more, 'https://tp.example.com/search-results?q=gear+box');
	// Tags are capped at five upstream, so there's never more to show.
	assert.equal((await run('tags', ' gear box ', fetch)).more, undefined);
});

test('a blank query or missing token asks nothing', async () => {
	const { fetch, calls } = fakeFetch();
	assert.deepEqual(await run('models', '   ', fetch), { results: [] });
	assert.deepEqual(await thingport.searchProviders.models.query({ config: { url: config.url }, query: 'x', fetch }), { results: [] });
	assert.equal(calls.length, 0);
});

test('the image proxy only fetches thumbnail paths', async () => {
	const { fetch, calls } = fakeFetch();
	const proxy = thingport.proxy.image;
	const bad = await proxy.fetch({ config, params: { path: ['profile', 'api-token'] }, fetch });
	assert.equal(bad.status, 400);
	await proxy.fetch({ config, params: { path: ['plate', 'p1', 'thumb.jpg'] }, fetch });
	assert.deepEqual(calls.map((c) => c.url), ['https://tp.example.com/api/plate/p1/thumb.jpg']);
});
