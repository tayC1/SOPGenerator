const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../../public/markdown.js');

test('renders an :::email fence as a styled card with To/Subject/body', () => {
  const html = renderMarkdown(':::email\nTo: jane@example.com\nSubject: Weekly update\n\nEverything shipped on time.\n:::');
  assert.match(html, /<div class="email-card">/);
  assert.match(html, /email-card-label">To<\/span><span class="email-card-value">jane@example\.com/);
  assert.match(html, /email-card-label">Subject<\/span><span class="email-card-value">Weekly update/);
  assert.match(html, /<div class="email-card-body"><p>Everything shipped on time\.<\/p><\/div>/);
});

test('renders unfilled email placeholders as literal text, not blank', () => {
  const html = renderMarkdown(':::email\nTo: {{recipient}}\nSubject: {{subject}}\n\n{{body}}\n:::');
  assert.match(html, /email-card-value">\{\{recipient\}\}/);
  assert.match(html, /email-card-value">\{\{subject\}\}/);
  assert.match(html, /<p>\{\{body\}\}<\/p>/);
});

test('shows the empty placeholder when To/Subject are missing entirely', () => {
  const html = renderMarkdown(':::email\n\nJust a body, no header fields.\n:::');
  assert.match(html, /email-card-empty/);
});

test('renders an email fence left unclosed at end of document', () => {
  const html = renderMarkdown(':::email\nTo: a@b.com\nSubject: No closing fence\n\nStill renders.');
  assert.match(html, /<div class="email-card">/);
  assert.match(html, /Still renders\./);
});

test('escapes HTML inside an email body so it cannot inject markup', () => {
  const html = renderMarkdown(':::email\nTo: a@b.com\nSubject: XSS test\n\n<script>alert(1)</script>\n:::');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('non-email documents are unaffected', () => {
  const html = renderMarkdown('# Heading\n\nSome **bold** text.');
  assert.doesNotMatch(html, /email-card/);
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
});
