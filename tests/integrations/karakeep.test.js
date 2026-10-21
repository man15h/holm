// Unit tests for src/lib/server/integrations/karakeep.js: Tags and Lists
// answer only under the scope, picking one sends Karakeep's own `#"tag"` /
// `list:"name"`, and a filter it didn't make is refused.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';

import karakeep from '../../src/lib/server/integrations/karakeep.js';

const config = { url: 'https://kk.example.com/', apiKey: 'key' };

function fakeFetch(body) {
	const calls = [];
	const fetch = async (url, init) => {
		calls.push({ url: new URL(url), init });
		return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
	};
	return { fetch, calls };
}

const { bookmarks, tags, lists } = karakeep.searchProviders;
const bookmark = { id: 'b1', title: 'Pasta', tags: [{ name: 'recipes' }], content: { type: 'link', url: 'https://food.example.com/pasta' } };

test('Tags and Lists are scope-only; only Bookmarks searches inside a filter', () => {
	assert.equal(tags.scoped, true);
	assert.equal(lists.scoped, true);
	assert.ok(!bookmarks.scoped);
	assert.equal(bookmarks.filters, true);
	assert.ok(!tags.filters && !lists.filters);
});

test('a tag filter prefixes the query, and an empty query lists the tag', async () => {
	const { fetch, calls } = fakeFetch({ bookmarks: [bookmark] });
	const res = await bookmarks.query({ config, query: ' pasta ', limit: 24, fetch, filter: { tag: 'quick meals' } });
	assert.equal(calls[0].url.pathname, '/api/v1/bookmarks/search');
	assert.equal(calls[0].url.searchParams.get('q'), '#"quick meals" pasta');
	assert.equal(res.results[0].href, 'https://food.example.com/pasta');
	assert.equal(res.more, 'https://kk.example.com/dashboard/search?q=%23%22quick+meals%22+pasta');

	await bookmarks.query({ config, query: '', limit: 24, fetch, filter: { list: 'Read later' } });
	assert.equal(calls[1].url.searchParams.get('q'), 'list:"Read later"');
});

test('without a filter the query is sent as typed', async () => {
	const { fetch, calls } = fakeFetch({ bookmarks: [] });
	await bookmarks.query({ config, query: 'pasta', limit: 24, fetch });
	assert.equal(calls[0].url.searchParams.get('q'), 'pasta');
	assert.deepEqual(await bookmarks.query({ config, query: '  ', limit: 24, fetch }), { results: [] });
	assert.equal(calls.length, 1);
});

test('a filter Karakeep cannot quote, or one this adapter never made, searches nothing', async () => {
	const { fetch, calls } = fakeFetch({ bookmarks: [bookmark] });
	for (const filter of [{ tag: 'say "hi"' }, { tag: '' }, { list: 42 }, { folder: 'x' }, { tag: 'x'.repeat(201) }]) {
		assert.deepEqual(await bookmarks.query({ config, query: 'pasta', limit: 24, fetch, filter }), { results: [] });
	}
	assert.equal(calls.length, 0);
});

test('tags match by name, most-used first, and drill in by name', async () => {
	const { fetch, calls } = fakeFetch({
		tags: [
			{ id: 't1', name: 'recipes', numBookmarks: 3 },
			{ id: 't2', name: 'Recipes to try', numBookmarks: 12 },
			{ id: 't3', name: 'travel', numBookmarks: 40 },
			{ id: 't4', name: 'recipes "best"', numBookmarks: 1 }
		]
	});
	const res = await tags.query({ config, query: 'Recip', limit: 24, fetch });
	assert.equal(calls[0].url.pathname, '/api/v1/tags');
	assert.equal(calls[0].url.searchParams.get('nameContains'), 'recip');
	assert.deepEqual(res.results.map((r) => r.title), ['#Recipes to try', '#recipes']);
	assert.deepEqual(res.results[1], {
		id: 't1',
		title: '#recipes',
		subtitle: '3 bookmarks',
		href: 'https://kk.example.com/dashboard/tags/t1',
		filter: { label: '#recipes', params: { tag: 'recipes' } },
		meta: { kind: 'tag' }
	});
});

test('lists match by name, only the user\'s own, and drill in by name', async () => {
	const { fetch } = fakeFetch({
		lists: [
			{ id: 'l1', name: 'Read later', icon: '📚', type: 'manual', userRole: 'owner' },
			{ id: 'l2', name: 'Shared reading', icon: '🤝', type: 'manual', userRole: 'editor' },
			{ id: 'l3', name: 'Unread', icon: '🔎', type: 'smart' }
		]
	});
	const res = await lists.query({ config, query: 'read', limit: 24, fetch });
	assert.deepEqual(res.results.map((r) => [r.title, r.subtitle, r.filter.params.list]), [
		['📚 Read later', 'List', 'Read later'],
		['🔎 Unread', 'Smart list', 'Unread']
	]);
	assert.equal(res.results[0].href, 'https://kk.example.com/dashboard/lists/l1');
	assert.equal(res.results[0].meta.kind, 'collection');
});

test('Tags and Lists ask nothing for an empty query', async () => {
	const { fetch, calls } = fakeFetch({});
	assert.deepEqual(await tags.query({ config, query: ' ', limit: 24, fetch }), { results: [] });
	assert.deepEqual(await lists.query({ config, query: '', limit: 24, fetch }), { results: [] });
	assert.equal(calls.length, 0);
});
