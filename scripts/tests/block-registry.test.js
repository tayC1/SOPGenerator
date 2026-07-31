const test = require('node:test');
const assert = require('node:assert/strict');
const { getBlocks, filterBlocks } = require('../../public/block-registry.js');

test('getBlocks returns the full seeded list', () => {
  const blocks = getBlocks();
  assert.equal(blocks.length, 7);
  assert.ok(blocks.every((b) => b.id && b.label && b.icon && b.template));
});

test('filterBlocks with an empty query returns everything', () => {
  assert.equal(filterBlocks('').length, getBlocks().length);
  assert.equal(filterBlocks('   ').length, getBlocks().length);
});

test('filterBlocks matches by label prefix, case-insensitively', () => {
  const results = filterBlocks('callout');
  assert.ok(results.some((b) => b.id === 'callout'));
});

test('filterBlocks matches by keyword even when the label differs', () => {
  const results = filterBlocks('terminal');
  assert.ok(results.some((b) => b.id === 'command'));
});

test('filterBlocks returns no results for a query nothing matches', () => {
  assert.deepEqual(filterBlocks('zzzznotarealblock'), []);
});
