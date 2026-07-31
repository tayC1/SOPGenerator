// Small, dependency-free markdown -> HTML renderer shared by sop.html
// (rendering a saved reference document) and new-document.html (live
// preview while writing one). No CDN library is loaded anywhere else in
// this app, so this stays self-contained rather than pulling one in.
//
// Safety: the raw markdown is HTML-escaped in full before any markdown
// syntax is turned into tags, so anything the author typed - including
// literal <script> tags - can never survive as real markup. Only the
// tags this file inserts itself end up unescaped in the output. Link
// hrefs are additionally restricted to http(s)/mailto schemes.
//
// Supported syntax: headings (#..######), bold (**/__), italic (*/_),
// inline code, fenced code blocks, blockquotes (>), unordered/ordered
// lists, links, horizontal rules, paragraphs (single newlines inside a
// paragraph become <br>, matching how most reference docs are typed), and
// a `:::email ... :::` fence (see renderEmailCard) that the slash-menu's
// email block inserts, rendered as a styled To/Subject/body card rather
// than plain text.
//
// Unlike the rest of public/*.js, this also exports via module.exports
// when run under Node so scripts/tests/*.test.js can require() it
// directly without a DOM.
(function (global) {
  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Runs on already-escaped text, so the only special characters left to
  // interpret are markdown's own (*, _, `, [, ], (, )) - none of which
  // HTML-escaping touches.
  function renderInline(text) {
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Images (![alt](src)) have to be handled before the link rule below,
    // since a leading "!" is the only thing that distinguishes them from
    // a plain link - otherwise the link rule would match the "[alt](src)"
    // part and turn an image into a clickable link instead. data: URIs
    // (inline base64 images) are allowed here in addition to http(s),
    // unlike plain links, since that's how this app embeds images.
    text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
      const safeSrc = /^(https?:|data:image\/)/i.test(src) ? src : null;
      return safeSrc
        ? `<img src="${safeSrc}" alt="${alt}" loading="lazy">`
        : `[image unavailable: ${alt || src}]`;
    });
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    text = text.replace(/(^|[^\w])_([^_]+)_(?!\w)/g, '$1<em>$2</em>');
    text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const safeHref = /^(https?:|mailto:)/i.test(url) ? url : '#';
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    return text;
  }

  // Some documents were pasted in wholesale (frontmatter block and all)
  // rather than going through scripts/import-markdown.js, which is the
  // only thing that actually strips it - the web editor has no
  // frontmatter awareness at all. Strip a leading "---"-delimited block
  // here too so it never shows up in the rendered view, regardless of
  // how a document ended up with one in its stored content.
  function stripFrontmatter(raw) {
    const text = String(raw ?? '');
    const lines = text.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return text;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') return lines.slice(i + 1).join('\n');
    }
    return text; // no closing "---" - not actually a frontmatter block
  }

  // Renders a `:::email` fence's body as a styled To/Subject/message card
  // instead of plain text. lines have already been through escapeHtml (same
  // as every other line renderMarkdown sees), so only markdown syntax -
  // handled by renderInline - is left to interpret.
  function renderEmailCard(fenceLines) {
    const remaining = fenceLines.slice();
    let to = '';
    let subject = '';

    // Pull recognized header lines off the front, in either order, and
    // stop at the first line that isn't a To:/Subject: field.
    while (remaining.length) {
      const toMatch = remaining[0].match(/^To:\s?(.*)$/i);
      const subjectMatch = remaining[0].match(/^Subject:\s?(.*)$/i);
      if (toMatch) {
        to = toMatch[1];
        remaining.shift();
      } else if (subjectMatch) {
        subject = subjectMatch[1];
        remaining.shift();
      } else {
        break;
      }
    }
    // Drop a single blank separator line between the header and the body.
    if (remaining.length && remaining[0].trim() === '') remaining.shift();

    const bodyParagraphs = [];
    let para = [];
    const flushBody = () => {
      if (para.length) {
        bodyParagraphs.push(`<p>${para.map(renderInline).join('<br>')}</p>`);
        para = [];
      }
    };
    for (const line of remaining) {
      if (line.trim() === '') flushBody();
      else para.push(line);
    }
    flushBody();

    const field = (label, value) =>
      `<div class="email-card-field"><span class="email-card-label">${label}</span><span class="email-card-value">${
        value ? renderInline(value) : '<span class="email-card-empty">—</span>'
      }</span></div>`;

    return (
      '<div class="email-card">' +
        '<div class="email-card-header">' +
          '<div class="email-card-icon">✉️</div>' +
          '<div class="email-card-fields">' +
            field('To', to) +
            field('Subject', subject) +
          '</div>' +
        '</div>' +
        `<div class="email-card-body">${bodyParagraphs.join('') || '<p class="email-card-empty">No message body.</p>'}</div>` +
      '</div>'
    );
  }

  function renderMarkdown(raw) {
    const lines = escapeHtml(stripFrontmatter(raw)).split(/\r?\n/);
    const out = [];

    let paragraph = [];
    let list = null; // { type: 'ul' | 'ol', items: [] }
    let quote = null; // string[]
    let inCode = false;
    let code = [];
    let inEmail = false;
    let emailLines = [];

    function flushParagraph() {
      if (paragraph.length) {
        out.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
        paragraph = [];
      }
    }
    function flushList() {
      if (list) {
        const items = list.items.map((i) => `<li>${renderInline(i)}</li>`).join('');
        out.push(`<${list.type}>${items}</${list.type}>`);
        list = null;
      }
    }
    function flushQuote() {
      if (quote) {
        out.push(`<blockquote>${quote.map(renderInline).join('<br>')}</blockquote>`);
        quote = null;
      }
    }

    for (const line of lines) {
      if (/^```/.test(line.trim())) {
        if (inCode) {
          out.push(`<pre><code>${code.join('\n')}</code></pre>`);
          code = [];
          inCode = false;
        } else {
          flushParagraph();
          flushList();
          flushQuote();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        code.push(line);
        continue;
      }

      if (/^:::email\s*$/.test(line.trim())) {
        flushParagraph();
        flushList();
        flushQuote();
        inEmail = true;
        emailLines = [];
        continue;
      }
      if (inEmail) {
        if (line.trim() === ':::') {
          out.push(renderEmailCard(emailLines));
          emailLines = [];
          inEmail = false;
        } else {
          emailLines.push(line);
        }
        continue;
      }

      if (line.trim() === '') {
        flushParagraph();
        flushList();
        flushQuote();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.*)$/);
      if (heading) {
        flushParagraph();
        flushList();
        flushQuote();
        const level = heading[1].length;
        out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }

      if (/^(---|\*\*\*|___)\s*$/.test(line.trim())) {
        flushParagraph();
        flushList();
        flushQuote();
        out.push('<hr>');
        continue;
      }

      // '>' was HTML-escaped to '&gt;' above, so the blockquote marker
      // has to be matched in its escaped form here.
      const quoted = line.match(/^&gt;\s?(.*)$/);
      if (quoted) {
        flushParagraph();
        flushList();
        quote = quote || [];
        quote.push(quoted[1]);
        continue;
      }

      const ulItem = line.match(/^[-*]\s+(.*)$/);
      const olItem = line.match(/^\d+\.\s+(.*)$/);
      if (ulItem || olItem) {
        flushParagraph();
        flushQuote();
        const type = ulItem ? 'ul' : 'ol';
        if (!list || list.type !== type) {
          flushList();
          list = { type, items: [] };
        }
        list.items.push(ulItem ? ulItem[1] : olItem[1]);
        continue;
      }

      flushList();
      flushQuote();
      paragraph.push(line);
    }

    flushParagraph();
    flushList();
    flushQuote();
    if (inCode) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
    if (inEmail) out.push(renderEmailCard(emailLines));

    return out.join('\n') || '<p class="doc-empty">Nothing written yet.</p>';
  }

  const api = { renderMarkdown, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CodexMarkdown = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
