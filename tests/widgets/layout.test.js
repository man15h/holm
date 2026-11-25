// Unit tests for src/lib/widgets/layout.js — pure JS, no DOM, no SvelteKit.
// Run: node --test tests/widgets/layout.test.js
//
// These cover the migration helpers + position math that determine
// first-load-after-deploy correctness. Highest-value tests in the rewrite.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	defaultWidgetLayout,
	synthesizeFromLegacyPrefs,
	findFreeSlot,
	clamp,
	updateLayoutPositions,
	updateInstanceConfig,
	addInstance,
	addAppInstance,
	removeInstance,
	findAppInstance,
	reconcileGrantedApps,
	isNewApp,
	NEW_APP_MS
} from '../../src/lib/widgets/layout.js';

import { WIDGET_TYPES } from '../../src/lib/widgets/registry.js';

// Stub registry — keeps tests independent of registry.js's identity (registry.js
// has no Svelte/DOM imports for the `app` type, so we could import it directly,
// but stubbing future-proofs us once aggregator widgets land).
const stubRegistry = {
	[WIDGET_TYPES.APP]: {
		type: WIDGET_TYPES.APP,
		displayName: 'App',
		defaultSize: { w: 1, h: 1 },
		minSize: { w: 1, h: 1 },
		maxSize: { w: 3, h: 3 },
		defaultConfig: { appId: null }
	}
};

const sampleCatalog = [
	{ id: 'photos', name: 'Photos', default: true, selfHosted: true },
	{ id: 'cloud', name: 'Cloud', default: true, selfHosted: true },
	{ id: 'vault', name: 'Vault', default: false, selfHosted: true }
];

test('defaultWidgetLayout seeds one app tile per default-visible app', () => {
	const layout = defaultWidgetLayout(sampleCatalog, stubRegistry);
	assert.equal(layout.length, 2); // photos + cloud (vault is default:false)
	for (const inst of layout) {
		assert.equal(inst.type, WIDGET_TYPES.APP);
		assert.equal(inst.w, 1);
		assert.equal(inst.h, 1);
		assert.ok(inst.config.appId);
	}
	// Unique instanceIds
	const ids = new Set(layout.map((i) => i.instanceId));
	assert.equal(ids.size, layout.length);
});

test('defaultWidgetLayout places default-visible apps that are not self-hosted', () => {
	// self_hosted only feeds onboarding's services slide; placement is default_visible's job
	const layout = defaultWidgetLayout([{ id: 'jellyfin', name: 'Jellyfin', default: true, selfHosted: false }], stubRegistry);
	assert.deepEqual(layout.map((i) => i.config.appId), ['jellyfin']);
});

test('synthesizeFromLegacyPrefs preserves categoryLayout ordering', () => {
	const legacy = {
		categoryLayout: [
			{ id: 'social', label: 'Social', appIds: ['cloud'] },
			{ id: 'storage', label: 'Storage', appIds: ['photos', 'vault'] }
		]
	};
	const layout = synthesizeFromLegacyPrefs(legacy, sampleCatalog, stubRegistry);
	const appIds = layout.map((i) => i.config.appId);
	assert.deepEqual(appIds, ['cloud', 'photos', 'vault']);
});

test('synthesizeFromLegacyPrefs falls back to defaults when nothing legacy is present', () => {
	const layout = synthesizeFromLegacyPrefs({}, sampleCatalog, stubRegistry);
	// No legacy → fall back to defaultWidgetLayout (photos + cloud)
	assert.equal(layout.length, 2);
});

test('synthesizeFromLegacyPrefs picks up visibleApps when categoryLayout is empty', () => {
	const legacy = { visibleApps: ['vault', 'photos'] };
	const layout = synthesizeFromLegacyPrefs(legacy, sampleCatalog, stubRegistry);
	const appIds = layout.map((i) => i.config.appId);
	assert.deepEqual(appIds, ['vault', 'photos']);
});

test('synthesizeFromLegacyPrefs drops apps missing from the catalog', () => {
	const legacy = {
		categoryLayout: [{ id: 'tools', label: 'Tools', appIds: ['arr-only', 'photos'] }]
	};
	const layout = synthesizeFromLegacyPrefs(legacy, sampleCatalog, stubRegistry);
	const appIds = layout.map((i) => i.config.appId);
	assert.deepEqual(appIds, ['photos']);
});

test('synthesizeFromLegacyPrefs deduplicates appIds across sources', () => {
	const legacy = {
		categoryLayout: [{ id: 'storage', label: 'Storage', appIds: ['photos'] }],
		visibleApps: ['photos', 'cloud']
	};
	const layout = synthesizeFromLegacyPrefs(legacy, sampleCatalog, stubRegistry);
	const appIds = layout.map((i) => i.config.appId);
	assert.deepEqual(appIds, ['photos', 'cloud']);
});

test('findFreeSlot picks (0,0) on empty layout', () => {
	assert.deepEqual(findFreeSlot([], 1, 1), { x: 0, y: 0 });
});

test('findFreeSlot avoids overlap', () => {
	const layout = [
		{ instanceId: 'a', type: WIDGET_TYPES.APP, x: 0, y: 0, w: 1, h: 1, config: {} }
	];
	assert.deepEqual(findFreeSlot(layout, 1, 1), { x: 1, y: 0 });
});

test('findFreeSlot wraps to next row when current row is full', () => {
	const layout = [];
	for (let x = 0; x < 12; x++) {
		layout.push({ instanceId: 'a' + x, type: WIDGET_TYPES.APP, x, y: 0, w: 1, h: 1, config: {} });
	}
	assert.deepEqual(findFreeSlot(layout, 1, 1), { x: 0, y: 1 });
});

test('clamp respects registry min/max sizes', () => {
	const entry = stubRegistry[WIDGET_TYPES.APP];
	const oversize = { instanceId: 'x', type: WIDGET_TYPES.APP, x: 0, y: 0, w: 99, h: 99, config: {} };
	const c = clamp(oversize, entry);
	assert.equal(c.w, entry.maxSize.w);
	assert.equal(c.h, entry.maxSize.h);
});

test('clamp keeps x within grid bounds', () => {
	const entry = stubRegistry[WIDGET_TYPES.APP];
	const offgrid = { instanceId: 'x', type: WIDGET_TYPES.APP, x: 15, y: 0, w: 1, h: 1, config: {} };
	const c = clamp(offgrid, entry);
	assert.ok(c.x + c.w <= 12);
});

test('updateLayoutPositions patches matched instances immutably', () => {
	const layout = [
		{ instanceId: 'a', type: WIDGET_TYPES.APP, x: 0, y: 0, w: 1, h: 1, config: {} },
		{ instanceId: 'b', type: WIDGET_TYPES.APP, x: 1, y: 0, w: 1, h: 1, config: {} }
	];
	const next = updateLayoutPositions(layout, [{ instanceId: 'a', x: 5, y: 0, w: 1, h: 1 }]);
	assert.equal(next[0].x, 5);
	assert.equal(next[1].x, 1); // untouched
	assert.equal(layout[0].x, 0); // original not mutated
});

test('updateInstanceConfig merges per-instance config', () => {
	const layout = [
		{
			instanceId: 'a',
			type: WIDGET_TYPES.APP,
			x: 0,
			y: 0,
			w: 1,
			h: 1,
			config: { appId: 'photos' }
		}
	];
	const next = updateInstanceConfig(layout, 'a', { appId: 'cloud' });
	assert.equal(next[0].config.appId, 'cloud');
	assert.equal(layout[0].config.appId, 'photos'); // original not mutated
});

test('addAppInstance places a new app tile in the first free slot', () => {
	const layout = [
		{ instanceId: 'a', type: WIDGET_TYPES.APP, x: 0, y: 0, w: 1, h: 1, config: { appId: 'photos' } }
	];
	const next = addAppInstance(layout, 'cloud', stubRegistry);
	assert.equal(next.length, 2);
	assert.equal(next[1].config.appId, 'cloud');
	assert.equal(next[1].x, 1);
	assert.equal(next[1].y, 0);
});

test('addInstance throws on unknown type', () => {
	assert.throws(() => addInstance([], 'unknown-widget', stubRegistry));
});

test('removeInstance drops the matching instance', () => {
	const layout = [
		{ instanceId: 'a', type: WIDGET_TYPES.APP, x: 0, y: 0, w: 1, h: 1, config: { appId: 'photos' } },
		{ instanceId: 'b', type: WIDGET_TYPES.APP, x: 1, y: 0, w: 1, h: 1, config: { appId: 'cloud' } }
	];
	const next = removeInstance(layout, 'a');
	assert.equal(next.length, 1);
	assert.equal(next[0].instanceId, 'b');
});

test('findAppInstance returns the matching tile or null', () => {
	const layout = [
		{ instanceId: 'a', type: WIDGET_TYPES.APP, x: 0, y: 0, w: 1, h: 1, config: { appId: 'photos' } }
	];
	assert.equal(findAppInstance(layout, 'photos').instanceId, 'a');
	assert.equal(findAppInstance(layout, 'cloud'), null);
	assert.equal(findAppInstance(null, 'photos'), null);
});

// ── Newly granted apps (#135) ──

const NOW = Date.parse('2026-11-25T12:00:00Z');
const appIds = (layout) => layout.map((i) => i.config.appId);
const recipes = { id: 'recipes', name: 'Recipes', default: true, selfHosted: true };

test('reconcileGrantedApps seeds seenAppIds with the whole catalog, no pills', () => {
	const prefs = { widgetLayout: defaultWidgetLayout(sampleCatalog, stubRegistry) };
	const next = reconcileGrantedApps(prefs, sampleCatalog, stubRegistry, { now: NOW });
	assert.deepEqual(next.seenAppIds.sort(), ['cloud', 'photos', 'vault']);
	assert.deepEqual(next.newApps, {});
	assert.deepEqual(appIds(next.widgetLayout), ['photos', 'cloud']);
});

test('reconcileGrantedApps returns null once everything is seen and placed', () => {
	const prefs = { widgetLayout: defaultWidgetLayout(sampleCatalog, stubRegistry), seenAppIds: ['photos', 'cloud', 'vault'] };
	assert.equal(reconcileGrantedApps(prefs, sampleCatalog, stubRegistry, { now: NOW }), null);
	assert.equal(reconcileGrantedApps(prefs, sampleCatalog, stubRegistry, { customizable: true, now: NOW }), null);
});

for (const customizable of [false, true]) {
	test(`reconcileGrantedApps appends an unseen app with a pill (customization ${customizable ? 'on' : 'off'})`, () => {
		const prefs = { widgetLayout: defaultWidgetLayout(sampleCatalog, stubRegistry), seenAppIds: ['photos', 'cloud', 'vault'] };
		const next = reconcileGrantedApps(prefs, [...sampleCatalog, recipes], stubRegistry, { customizable, now: NOW });
		assert.deepEqual(appIds(next.widgetLayout), ['photos', 'cloud', 'recipes']);
		assert.ok(next.seenAppIds.includes('recipes'));
		assert.equal(next.newApps.recipes, new Date(NOW).toISOString());
		assert.ok(isNewApp(next.newApps, 'recipes', NOW));
	});
}

test('reconcileGrantedApps marks an unseen default_visible: false app seen but leaves it off the grid', () => {
	const prefs = { widgetLayout: [], seenAppIds: [] };
	const next = reconcileGrantedApps(prefs, [{ id: 'vault', name: 'Vault', default: false }], stubRegistry, { now: NOW });
	assert.deepEqual(next.widgetLayout, []);
	assert.deepEqual(next.seenAppIds, ['vault']);
	assert.deepEqual(next.newApps, {});
});

test('reconcileGrantedApps with customization off appends seen apps that have no tile, without a pill', () => {
	// Granted before this change: seeded as seen, never placed.
	const prefs = { widgetLayout: addAppInstance([], 'photos', stubRegistry) };
	const next = reconcileGrantedApps(prefs, [...sampleCatalog, recipes], stubRegistry, { now: NOW });
	assert.deepEqual(appIds(next.widgetLayout), ['photos', 'cloud', 'recipes']);
	assert.deepEqual(next.newApps, {});
});

test('reconcileGrantedApps with customization on leaves a removed app off the grid', () => {
	const prefs = { widgetLayout: addAppInstance([], 'photos', stubRegistry), seenAppIds: ['photos', 'cloud', 'vault'] };
	assert.equal(reconcileGrantedApps(prefs, sampleCatalog, stubRegistry, { customizable: true, now: NOW }), null);
});

test('reconcileGrantedApps gives no pill to an app whose access came back', () => {
	// Access lost: the tile stays in the layout, unrendered. Back: nothing to do.
	const prefs = { widgetLayout: defaultWidgetLayout(sampleCatalog, stubRegistry), seenAppIds: ['photos', 'cloud', 'vault'] };
	const without = sampleCatalog.filter((a) => a.id !== 'cloud');
	assert.equal(reconcileGrantedApps(prefs, without, stubRegistry, { now: NOW }), null);
	assert.equal(reconcileGrantedApps(prefs, sampleCatalog, stubRegistry, { customizable: true, now: NOW }), null);
});

test('reconcileGrantedApps drops pills older than seven days', () => {
	const seenAt = new Date(NOW).toISOString();
	const prefs = {
		widgetLayout: defaultWidgetLayout(sampleCatalog, stubRegistry),
		seenAppIds: ['photos', 'cloud', 'vault'],
		newApps: { cloud: seenAt }
	};
	assert.equal(reconcileGrantedApps(prefs, sampleCatalog, stubRegistry, { now: NOW + NEW_APP_MS - 1 }), null);
	const next = reconcileGrantedApps(prefs, sampleCatalog, stubRegistry, { now: NOW + NEW_APP_MS });
	assert.deepEqual(next.newApps, {});
});

test('isNewApp is false for unknown, unparsable and expired entries', () => {
	const at = new Date(NOW).toISOString();
	assert.equal(isNewApp({ recipes: at }, 'recipes', NOW + NEW_APP_MS - 1), true);
	assert.equal(isNewApp({ recipes: at }, 'recipes', NOW + NEW_APP_MS), false);
	assert.equal(isNewApp({ recipes: 'garbage' }, 'recipes', NOW), false);
	assert.equal(isNewApp({}, 'recipes', NOW), false);
	assert.equal(isNewApp(undefined, 'recipes', NOW), false);
});
