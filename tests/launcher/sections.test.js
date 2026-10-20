// Unit tests for how the search bar orders provider rows and folds
// video results into the Movies & TV shelf.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrangeProviderSections, topHit } from '../../src/lib/launcher/sections.js';

const section = (id, kind, items, extra = {}) => ({ id, label: id, layout: 'poster', kind, loading: false, error: '', items, ...extra });
const title = (key, tmdb, extra = {}) => ({ key, tmdb, showDetail: () => {}, ...extra });

test('one video provider keeps its own row', () => {
	const out = arrangeProviderSections([section('p-jellyfin', 'media', [title('a', 'movie:1')], { shelf: 'video' })]);
	assert.deepEqual(out.map((s) => s.id), ['p-jellyfin']);
});

test('video providers share one shelf: playable first, then requestable, then requested, deduped', () => {
	const out = arrangeProviderSections([
		section('p-docs', 'document', [{ key: 'd' }]),
		section('p-seerr', 'media', [title('s1', 'movie:1'), title('s2', 'movie:2', { request: { done: true } }), title('s3', 'movie:3')], { shelf: 'video' }),
		section('p-plex', 'media', [title('x1', 'movie:1', { play: {} }), { key: 'album', showDetail: null }], { shelf: 'video' })
	]);
	assert.deepEqual(out.map((s) => s.id), ['p-docs', 'p-media', 'p-plex']);
	assert.deepEqual(out[1].items.map((i) => i.key), ['x1', 's3', 's2']);
	// What's left of Plex (no detail view) stays, as tracks.
	assert.equal(out[2].layout, 'tracks');
	assert.deepEqual(out[2].items.map((i) => i.key), ['album']);
});

test('sections without a shelf are only ordered by kind', () => {
	const out = arrangeProviderSections([section('photo', 'photo', []), section('nav', 'media', [], { layout: 'tracks' }), section('x', 'other', [])]);
	assert.deepEqual(out.map((s) => s.id), ['nav', 'photo', 'x']);
});

test('documents and files come before media and photos', () => {
	const out = arrangeProviderSections([section('photo', 'photo', []), section('media', 'media', []), section('file', 'file', []), section('doc', 'document', [])]);
	assert.deepEqual(out.map((s) => s.id), ['doc', 'file', 'media', 'photo']);
});

test('the top hit is a title equal to the query or starting with it, never a looser match', () => {
	const docs = section('docs', 'document', [{ key: 'a', title: 'Tax return 2025' }, { key: 'b', title: 'Invoice March' }]);
	const media = section('media', 'media', [{ key: 'c', title: 'Invoice March' }, { key: 'd', title: 'The March' }]);
	assert.equal(topHit('invoice march', [docs, media]).item.key, 'b');
	assert.equal(topHit('invoice', [docs, media]).item.key, 'b');
	assert.equal(topHit('march', [docs, media]), null);
	assert.equal(topHit('in', [docs, media]), null);
	assert.equal(topHit('more', [section('x', 'file', [{ key: 'm', title: 'More in Files', more: true }])]), null);
});

test('Thingport rows sit after bookmarks and before media: models, collections, tags', () => {
	const out = arrangeProviderSections([
		section('p-photos', 'photo', [{ key: 'p' }]),
		section('p-tags', 'tag', [{ key: 't' }]),
		section('p-media', 'media', [{ key: 'v' }]),
		section('p-collections', 'collection', [{ key: 'c' }]),
		section('p-models', 'model', [{ key: 'm' }]),
		section('p-bookmarks', 'bookmark', [{ key: 'b' }])
	]);
	assert.deepEqual(out.map((s) => s.id), ['p-bookmarks', 'p-models', 'p-collections', 'p-tags', 'p-media', 'p-photos']);
});
