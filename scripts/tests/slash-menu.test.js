const test = require('node:test');
const assert = require('node:assert/strict');
const { isTriggerPosition, isInsideFencedCode, extractQuery, buildInsertion, findNextPlaceholder } = require('../../public/slash-menu.js');

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

test('buildInsertion replaces the /query with the template', () => {
  const result = buildInsertion('before /wa after', 7, 10, '> ⚠️ **{{label}}:** {{text}}');
  assert.equal(result.newText, 'before > ⚠️ **{{label}}:** {{text}} after');
});

test('buildInsertion selects the template\'s first placeholder', () => {
  const template = '**To:** {{recipient}}\n**Subject:** {{subject}}';
  const result = buildInsertion('/email', 0, 6, template);
  const inserted = result.newText.slice(result.selectionStart, result.selectionEnd);
  assert.equal(inserted, '{{recipient}}');
});

test('buildInsertion places the caret at the end when the template has no placeholder', () => {
  const result = buildInsertion('/hr', 0, 3, '---');
  assert.equal(result.selectionStart, 3);
  assert.equal(result.selectionEnd, 3);
});

test('findNextPlaceholder finds the next token after the given index', () => {
  const text = '**To:** {{recipient}}\n**Subject:** {{subject}}';
  const next = findNextPlaceholder(text, 22);
  assert.equal(text.slice(next.start, next.end), '{{subject}}');
});

test('findNextPlaceholder wraps around to the first token', () => {
  const text = '**To:** {{recipient}}\n**Subject:** {{subject}}';
  const next = findNextPlaceholder(text, text.length);
  assert.equal(text.slice(next.start, next.end), '{{recipient}}');
});

test('findNextPlaceholder returns null when there are no tokens', () => {
  assert.equal(findNextPlaceholder('plain text, no tokens here', 0), null);
});
