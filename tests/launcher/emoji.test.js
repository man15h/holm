// Unit tests for the launcher's emoji search, against the real Emojibase
// data the browser loads.
// Run: npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, searchEmoji, emojiQuery } from '../../src/lib/launcher/emoji.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../../node_modules/emojibase-data/en/${p}`, import.meta.url)));
const index = buildIndex(read('compact.json'), read('shortcodes/github.json'));
const top = (q, n = 1) => searchEmoji(index, q, n).map((e) => e.emoji);

test('reads ":fire", "fire emoji" and "emoji fire"; leaves the rest alone', () => {
	assert.deepEqual(emojiQuery(':fire'), { term: 'fire', only: true });
	assert.deepEqual(emojiQuery(':+1:'), { term: '+1', only: true });
	assert.deepEqual(emojiQuery(':'), { term: '', only: true });
	assert.deepEqual(emojiQuery('party emoji'), { term: 'party', only: false });
	assert.deepEqual(emojiQuery('emoji heart'), { term: 'heart', only: false });
	for (const q of ['fire', 'http://x', ': fire', 'emoji', '12:30']) assert.equal(emojiQuery(q), null, q);
});

test('finds by name, shortcode and tag', () => {
	assert.deepEqual(top('fire'), ['🔥']);
	assert.deepEqual(top('tada'), ['🎉']);
	assert.deepEqual(top('+1'), ['👍️']);
	assert.deepEqual(top(':rocket:'), ['🚀']);
	// A tag: "lit" isn't in the fire emoji's name.
	assert.ok(top('lit', 5).includes('🔥'));
});

test('ranks an exact shortcode first, then name prefixes, and keeps Emojibase order on ties', () => {
	const heart = searchEmoji(index, 'heart', 48);
	// :heart: is the red heart's shortcode.
	assert.equal(heart[0].emoji, '❤️');
	assert.ok(heart.slice(1, 5).every((e) => e.name.startsWith('heart')));
	assert.deepEqual(top('', 3), index.slice(0, 3).map((e) => e.emoji));
});

test('leaves out skin-tone parts and regional letters', () => {
	assert.equal(index.some((e) => /skin tone$|^regional indicator/.test(e.name)), false);
	assert.deepEqual(top('zzzzqq'), []);
});
