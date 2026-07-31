const test = require('node:test');
const assert = require('node:assert/strict');
const { isTriggerPosition, isInsideFencedCode, extractQuery } = require('../../public/slash-menu.js');

test('isTriggerPosition fires at the very start of the text', () => {
  assert.equal(isTriggerPosition('/', 1), true);
});

test('isTriggerPosition fires after whitespace', () => {
  assert.equal(isTriggerPosition('hello /', 7), true);
  assert.equal(isTriggerPosition('hello\n/', 7), true);
});

test('isTriggerPosition does not fire mid-word', () => {
  assert.equal(isTriggerPosition('hello/', 6), false);
});

test('isTriggerPosition is false when the caret is not right after a slash', () => {
  assert.equal(isTriggerPosition('/abc', 4), false);
});

test('isInsideFencedCode is false with no fences', () => {
  assert.equal(isInsideFencedCode('plain text', 5), false);
});

test('isInsideFencedCode is true inside an open fence', () => {
  const text = '```\ncode here';
  assert.equal(isInsideFencedCode(text, text.length), true);
});

test('isInsideFencedCode is false after a fence is closed', () => {
  const text = '```\ncode\n```\nafter';
  assert.equal(isInsideFencedCode(text, text.length), false);
});

test('extractQuery returns the text typed since the trigger', () => {
  assert.equal(extractQuery('/warn', 0, 5), 'warn');
});

test('extractQuery closes the session on whitespace', () => {
  assert.equal(extractQuery('/warn ing', 0, 9), null);
});

test('extractQuery closes the session if the caret moved before the trigger', () => {
  assert.equal(extractQuery('/warn', 0, 0), null);
});
