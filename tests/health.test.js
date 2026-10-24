// Unit tests for app health: src/lib/server/health/ and src/lib/health.js.
// Run: node --test tests/health.test.js

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { healthError, healthSource, appHealth, parseEvery } from '../src/lib/server/health/config.js';
import { matchMonitor, namedMonitor, kenerStatus, kumaMonitors, httpStatus } from '../src/lib/server/health/sources.js';
import { healthFor, healthSettled, resetHealth } from '../src/lib/server/health/index.js';
import { healthLine, healthLabel } from '../src/lib/health.js';

const KENER = { source: 'kener', url: 'https://status.example.com', api_key: 'k' };
const app = (id, more = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), url: `https://${id}.example.com`, ...more });

// A fetch that answers by URL: `routes` maps a substring to a reply (an
// object for JSON, a string for text, a number for a status, or an Error).
function fakeFetch(routes) {
	const f = async (url) => {
		f.calls.push(String(url));
		const key = Object.keys(routes).find((k) => String(url).includes(k));
		const reply = routes[key];
		if (reply instanceof Error) throw reply;
		if (typeof reply === 'number') return new Response('', { status: reply });
		if (typeof reply === 'string') return new Response(reply);
		return Response.json(reply ?? {});
	};
	f.calls = [];
	return f;
}

beforeEach(() => {
	resetHealth();
	console.warn = () => {};
});

// --- parsing ------------------------------------------------------------------

test('parseEvery: s, m, h and bare seconds', () => {
	assert.equal(parseEvery('30s'), 30_000);
	assert.equal(parseEvery('5m'), 300_000);
	assert.equal(parseEvery('1h'), 3_600_000);
	assert.equal(parseEvery(90), 90_000);
	assert.equal(parseEvery('soon'), null);
});

test('healthError: a good config passes', () => {
	const apps = [app('jellyfin', { health: true }), app('cloud', { health: 'nextcloud' }), app('navidrome', { health: { url: 'http://navidrome:4533/ping', every: '5m' } })];
	assert.equal(healthError({ health: { ...KENER, every: '60s' } }, apps), null);
	assert.equal(healthError({}, [app('a')]), null);
});

test('healthError: monitor and url together refuse to start, naming the app', () => {
	const err = healthError({ health: KENER }, [app('cloud', { health: { monitor: 'nextcloud', url: 'http://x' } })]);
	assert.match(err, /apps "cloud"/);
	assert.match(err, /monitor or url, not both/);
});

test('healthError: bad top-level settings', () => {
	assert.match(healthError({ health: { ...KENER, source: 'nagios' } }), /health.source/);
	assert.match(healthError({ health: { ...KENER, url: 'status.example.com' } }), /health.url/);
	assert.match(healthError({ health: { source: 'kener', url: KENER.url } }), /api_key/);
	assert.match(healthError({ health: { ...KENER, every: '10s' } }), /30s or more/);
	assert.match(healthError({ health: { ...KENER, colour: 'red' } }), /health.colour/);
	assert.match(healthError({ health: { ...KENER, page: 'status' } }), /health.page/);
	assert.equal(healthError({ health: { ...KENER, page: 'https://status.example.org/' } }), null);
});

test('healthError: bad per-app settings', () => {
	assert.match(healthError({ health: KENER }, [app('a', { health: { every: '5s', url: 'http://a' } })]), /apps "a": health.every/);
	assert.match(healthError({ health: KENER }, [app('a', { health: { url: 'ftp://a' } })]), /health.url/);
	assert.match(healthError({ health: KENER }, [app('a', { health: { enabled: 'yes' } })]), /enabled/);
	assert.match(healthError({ health: KENER }, [app('a', { health: 42 })]), /must be true, false/);
	// A monitor name needs a monitoring app to look it up in.
	assert.match(healthError({}, [app('a', { health: 'nextcloud' })]), /isn't kener or uptime_kuma/);
});

test('appHealth: the forms and what they mean', () => {
	const source = healthSource({ health: { ...KENER, every: '2m' } });
	assert.equal(appHealth(app('a'), source), null);
	assert.equal(appHealth(app('a', { health: false }), source), null);
	assert.deepEqual(appHealth(app('a', { health: true }), source), { find: true, every: 120_000 });
	assert.deepEqual(appHealth(app('a', { health: 'nextcloud' }), source), { monitor: 'nextcloud', every: 120_000 });
	assert.deepEqual(appHealth(app('a', { health: { url: 'http://a/ping', every: '5m' } }), source), { url: 'http://a/ping', every: 300_000 });
	// enabled: false switches it off and keeps the rest.
	assert.equal(appHealth(app('a', { health: { enabled: false, url: 'http://a/ping' } }), source), null);
	// Neither monitor nor url: found as `true` would be.
	assert.deepEqual(appHealth(app('a', { health: { every: '5m' } }), source), { find: true, every: 300_000 });
	// Without a monitoring app, `true` checks the app's own URL.
	assert.deepEqual(appHealth(app('a', { health: true }), null), { url: 'https://a.example.com', every: 60_000 });
});

// --- matching -----------------------------------------------------------------

const monitors = [
	{ key: 'photos-https', name: 'Immich', url: 'https://photos.example.com/api/ping' },
	{ key: 'beszel-lan', name: 'Beszel', url: 'https://beszel.lan' },
	{ key: 'nextcloud', name: 'Nextcloud', url: 'https://files.example.com' }
];

test("matchMonitor: by the URL's host first", () => {
	assert.equal(matchMonitor({ id: 'immich', name: 'Photos', url: 'https://photos.example.com' }, monitors).key, 'photos-https');
});

test('matchMonitor: then by name or id, ignoring case and punctuation', () => {
	assert.equal(matchMonitor({ id: 'stats', name: 'Beszel', url: 'https://stats.example.com' }, monitors).key, 'beszel-lan');
	assert.equal(matchMonitor({ id: 'nextcloud', name: 'Cloud', url: 'https://cloud.example.com' }, monitors).key, 'nextcloud');
	assert.equal(matchMonitor({ id: 'jellyfin', name: 'Jellyfin', url: 'https://jellyfin.example.com' }, monitors), null);
});

test('namedMonitor: by key, then by name', () => {
	assert.equal(namedMonitor('nextcloud', monitors).key, 'nextcloud');
	assert.equal(namedMonitor('immich', monitors).key, 'photos-https');
	assert.equal(namedMonitor('nope', monitors), null);
});

// --- sources ------------------------------------------------------------------

test('kenerStatus: the newest point, and when that state began', async () => {
	const now = 1_800_000_000_000;
	const t = now / 1000;
	const data = [{ timestamp: t - 900, status: 'UP' }, { timestamp: t - 600, status: 'DOWN' }, { timestamp: t - 300, status: 'DOWN' }];
	const fetch = fakeFetch({ '/data': { data } });
	const s = await kenerStatus(fetch, { url: 'https://k', apiKey: 'key' }, 'cloud', now);
	assert.deepEqual(s, { state: 'down', since: (t - 600) * 1000 });
	assert.match(fetch.calls[0], /\/api\/v4\/monitors\/cloud\/data\?start_ts=\d+&end_ts=\d+/);
});

test('kenerStatus: down for the whole window says so; old results are a failed check', async () => {
	const now = 1_800_000_000_000;
	const t = now / 1000;
	const all = await kenerStatus(fakeFetch({ '/data': { data: [{ timestamp: t - 600, status: 'DEGRADED' }, { timestamp: t - 300, status: 'DEGRADED' }] } }), { url: 'https://k' }, 'a', now);
	assert.equal(all.state, 'slow');
	assert.equal(all.longer, true);
	const stale = await kenerStatus(fakeFetch({ '/data': { data: [{ timestamp: t - 7200, status: 'UP' }] } }), { url: 'https://k' }, 'a', now);
	assert.equal(stale.state, 'failed');
});

test('kumaMonitors: reads /metrics with the key as the basic-auth password', async () => {
	const text = [
		'# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)',
		'monitor_status{monitor_id="3",monitor_name="Gitea",monitor_type="http",monitor_url="https://git.example.com",monitor_hostname="null",monitor_port="null"} 1',
		'monitor_status{monitor_name="DB",monitor_type="port",monitor_url="https://",monitor_hostname="db.lan",monitor_port="5432"} 0',
		'monitor_status{monitor_name="Mail",monitor_type="http",monitor_url="https://mail.example.com",monitor_hostname="null",monitor_port="null"} 2'
	].join('\n');
	let auth;
	const fetch = async (url, init) => ((auth = init.headers.authorization), new Response(text));
	const list = await kumaMonitors(fetch, { url: 'https://kuma', apiKey: 'uk1_x' });
	assert.equal(auth, `Basic ${Buffer.from(':uk1_x').toString('base64')}`);
	assert.deepEqual(list.map((m) => [m.key, m.url, m.state]), [['3', 'https://git.example.com', 'up'], ['DB', 'http://db.lan', 'down'], ['Mail', 'https://mail.example.com', 'slow']]);
});

test('httpStatus: 2xx, 3xx, 401, 403 and 429 are up; others and no answer are down, with why', async () => {
	assert.equal((await httpStatus(fakeFetch({ '': 401 }), 'http://a')).state, 'up');
	assert.equal((await httpStatus(fakeFetch({ '': 302 }), 'http://a')).state, 'up');
	assert.deepEqual(await httpStatus(fakeFetch({ '': 404 }), 'http://a'), { state: 'down', detail: 'answered 404 Not Found' });
	assert.deepEqual(await httpStatus(fakeFetch({ '': 502 }), 'http://a'), { state: 'down', detail: 'answered 502 Bad Gateway' });
	assert.equal((await httpStatus(fakeFetch({ '': new Error('ECONNREFUSED') }), 'http://a')).state, 'down');
});

// --- the shared cache ------------------------------------------------------------

const kenerList = { monitors: [{ tag: 'cloud', name: 'Cloud', status: 'ACTIVE', type_data: { url: 'https://cloud.example.com' } }] };

test('healthFor: one check per interval, however many ask', async () => {
	const now = 1_800_000_000_000;
	const fetch = fakeFetch({ '/data': { data: [{ timestamp: now / 1000 - 60, status: 'DOWN' }] }, '/api/v4/monitors': kenerList });
	const source = healthSource({ health: KENER });
	const apps = [app('cloud', { health: true })];
	for (let i = 0; i < 5; i++) healthFor(apps, source, { fetch, now });
	await healthSettled();
	for (let i = 0; i < 5; i++) healthFor(apps, source, { fetch, now });
	await healthSettled();
	assert.deepEqual(healthFor(apps, source, { fetch, now }).cloud, { state: 'down', since: now - 60_000, longer: true, source: 'Kener' });
	assert.equal(fetch.calls.filter((u) => u.includes('/data')).length, 1);
	assert.equal(fetch.calls.filter((u) => u.endsWith('/monitors?status=ACTIVE')).length, 1);
	// A minute on, the next check is due.
	healthFor(apps, source, { fetch, now: now + 60_000 });
	await healthSettled();
	assert.equal(fetch.calls.filter((u) => u.includes('/data')).length, 2);
});

test('healthFor: a Kener monitor that is down carries its description', async () => {
	const now = 1_800_000_000_000;
	const list = { monitors: [{ ...kenerList.monitors[0], description: 'Proxy has no route for it' }] };
	const fetch = fakeFetch({ '/data': { data: [{ timestamp: now / 1000 - 60, status: 'DOWN' }] }, '/api/v4/monitors': list });
	const source = healthSource({ health: KENER });
	const apps = [app('cloud', { health: true })];
	healthFor(apps, source, { fetch, now });
	await healthSettled();
	healthFor(apps, source, { fetch, now });
	await healthSettled();
	assert.equal(healthFor(apps, source, { fetch, now }).cloud.detail, 'Proxy has no route for it');
	// With a public status page set, the tip links to the monitor's page there.
	const linked = healthFor(apps, { ...source, page: 'https://status.example.org' }, { fetch, now }).cloud;
	assert.equal(linked.link, 'https://status.example.org/monitors/cloud');
});

test('healthFor: an ongoing Kener maintenance shows as maintenance, with its title', async () => {
	const now = 1_800_000_000_000;
	const t = now / 1000;
	const fetch = fakeFetch({
		'/maintenances/7/events': { events: [{ id: 1, status: 'ONGOING', start_date_time: t - 60, end_date_time: t + 3600 }] },
		'/maintenances?': { maintenances: [{ id: 7, title: 'New disk', description: 'Back by lunch.', status: 'ACTIVE', monitors: [{ monitor_tag: 'cloud', impact: 'MAINTENANCE' }] }] },
		'/data': { data: [{ timestamp: t - 60, status: 'DOWN' }] },
		'/api/v4/monitors': kenerList
	});
	const source = healthSource({ health: KENER });
	const apps = [app('cloud', { health: true })];
	for (let i = 0; i < 3; i++) {
		healthFor(apps, source, { fetch, now });
		await healthSettled();
	}
	assert.deepEqual(healthFor(apps, source, { fetch, now }).cloud, { state: 'maintenance', detail: 'New disk', note: 'Back by lunch.', until: (t + 3600) * 1000, source: 'Kener' });
});

test('healthFor: an open Kener incident says why, with its latest update, until it is resolved', async () => {
	const now = 1_800_000_000_000;
	const incidents = { incidents: [{ id: 1, title: 'Outside access paused', state: 'IDENTIFIED', monitors: [{ monitor_tag: 'cloud', impact: 'DEGRADED' }] }, { id: 2, title: 'Old', state: 'RESOLVED', monitors: [{ monitor_tag: 'cloud' }] }] };
	const comments = { comments: [{ id: 2, comment: 'Patched image due Friday.', timestamp: 20 }, { id: 1, comment: 'Looking into it.', timestamp: 10 }] };
	const fetch = fakeFetch({ '/incidents/1/comments': comments, '/incidents': incidents, '/data': { data: [{ timestamp: now / 1000 - 60, status: 'DOWN' }] }, '/api/v4/monitors': kenerList });
	const source = healthSource({ health: KENER });
	const apps = [app('cloud', { health: true })];
	for (let i = 0; i < 3; i++) {
		healthFor(apps, source, { fetch, now });
		await healthSettled();
	}
	assert.deepEqual(healthFor(apps, source, { fetch, now }).cloud, { state: 'slow', detail: 'Outside access paused', note: 'Patched image due Friday.', source: 'Kener' });
});

test('healthFor: no match is a warning and no dot; no answer from Kener is a failed check', async () => {
	const warnings = [];
	console.warn = (m) => warnings.push(m);
	const source = healthSource({ health: KENER });
	const apps = [app('jellyfin', { health: true }), app('cloud', { health: true })];
	healthFor(apps, source, { fetch: fakeFetch({ '/data': { data: [] }, '/api/v4/monitors': kenerList }) });
	await healthSettled();
	const out = healthFor(apps, source, { fetch: fakeFetch({}) });
	assert.equal(out.jellyfin, undefined);
	assert.match(warnings.join('\n'), /apps "jellyfin": no Kener monitor/);

	resetHealth();
	const down = fakeFetch({ '/api/v4/monitors': 401 });
	healthFor(apps, source, { fetch: down });
	await healthSettled();
	const failed = healthFor(apps, source, { fetch: down });
	assert.equal(failed.cloud.state, 'failed');
	assert.equal(failed.cloud.detail, 'Kener answered 401');
});

// --- the words ------------------------------------------------------------------

test('healthLine and healthLabel: name the state and who checked', () => {
	const now = 1_800_000_000_000;
	const cloud = { name: 'Cloud' };
	assert.equal(healthLine(cloud, { state: 'up', source: 'Kener' }), null);
	assert.deepEqual(healthLine(cloud, { state: 'down', since: now - 12 * 60_000, source: 'Kener' }, now), { tone: 'down', title: 'Cloud is down', rest: 'for 12 min', note: '', by: 'Checked by Kener', link: null });
	assert.equal(healthLine(cloud, { state: 'down', since: now - 7 * 3_600_000, longer: true, source: 'Holm' }, now).rest, 'for over 7 h');
	assert.equal(healthLine(cloud, { state: 'maintenance', source: 'Uptime Kuma' }).tone, 'slow');
	assert.equal(healthLine(cloud, { state: 'failed', detail: "Kener didn't answer", source: 'Kener' }).title, 'Status unknown');
	assert.equal(healthLabel(cloud, { state: 'down' }), 'Cloud, down');
	assert.equal(healthLabel(cloud, { state: 'up' }), 'Cloud');
	assert.equal(healthLabel(cloud, undefined), 'Cloud');
});
