// Unit tests for which providers the search bar asks: scope-only sections
// stay out of an everyday search, and a picked filter narrows to the
// providers that search inside it.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providersFor } from '../../src/lib/launcher/scope.js';
import { adapterToClient } from '../../src/lib/server/integrations/serialize.js';
import karakeep from '../../src/lib/server/integrations/karakeep.js';
import thingport from '../../src/lib/server/integrations/thingport.js';

const providers = [
	{ providerId: 'karakeep:bookmarks', integrationId: 'karakeep', filters: true },
	{ providerId: 'karakeep:tags', integrationId: 'karakeep', scoped: true },
	{ providerId: 'karakeep:lists', integrationId: 'karakeep', scoped: true },
	{ providerId: 'immich:photos', integrationId: 'immich' }
];
const ids = (list) => list.map((p) => p.providerId);

test('unscoped search leaves out scope-only sections', () => {
	assert.deepEqual(ids(providersFor(providers, null, null)), ['karakeep:bookmarks', 'immich:photos']);
});

test('scoped to an app, all its sections answer', () => {
	assert.deepEqual(ids(providersFor(providers, 'karakeep', null)), ['karakeep:bookmarks', 'karakeep:tags', 'karakeep:lists']);
	assert.deepEqual(ids(providersFor(providers, 'immich', null)), ['immich:photos']);
});

test('inside a filter, only the providers that take it answer', () => {
	const filter = { integrationId: 'karakeep', label: '#recipes', params: { tag: 'recipes' } };
	assert.deepEqual(ids(providersFor(providers, 'karakeep', filter)), ['karakeep:bookmarks']);
});

test('the browser learns which providers are scope-only or take a filter', () => {
	const { searchProviders } = adapterToClient(karakeep);
	assert.deepEqual(
		Object.fromEntries(Object.entries(searchProviders).map(([k, p]) => [k, [p.scoped, p.filters]])),
		{ bookmarks: [false, true], tags: [true, false], lists: [true, false] }
	);
});

test('Thingport shows Models in an everyday search, and Collections and Tags only under !tp', () => {
	const tp = Object.entries(adapterToClient(thingport).searchProviders).map(([key, p]) => ({
		providerId: `thingport:${key}`,
		integrationId: 'thingport',
		...p
	}));
	assert.deepEqual(ids(providersFor(tp, null, null)), ['thingport:models']);
	assert.deepEqual(ids(providersFor(tp, 'thingport', null)), ['thingport:models', 'thingport:collections', 'thingport:tags']);
});
