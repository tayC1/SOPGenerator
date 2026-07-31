// Slash-command block menu for a plain <textarea> (used against
// contentInput in new-document.html): trigger detection, live filtering,
// keyboard/click selection, insertion, and Tab-through placeholder fields.
//
// Exposes CodexSlashMenu.attach(textarea, options) in the browser, plus the
// pure helper functions (no DOM) via module.exports under Node for testing.
(function (global) {
  const PLACEHOLDER_RE = /\{\{[^{}]*\}\}/;
  const PLACEHOLDER_RE_G = /\{\{[^{}]*\}\}/g;

  // A trigger is a "/" preceded by start-of-text or whitespace - matches
  // Notion's "empty line or after whitespace" rule without needing to know
  // about lines specifically, since a newline is whitespace too.
  function isTriggerPosition(text, caretIndex) {
    if (caretIndex < 1 || text[caretIndex - 1] !== '/') return false;
    if (caretIndex === 1) return true;
    return /\s/.test(text[caretIndex - 2]);
  }

  // Counts fenced-code delimiters before caretIndex; an odd count means the
  // caret is inside an open ``` fence, where the menu shouldn't trigger.
  function isInsideFencedCode(text, caretIndex) {
    const before = text.slice(0, caretIndex);
    const fences = before.match(/```/g);
    return !!fences && fences.length % 2 === 1;
  }

  // Text typed after the "/" so far, or null if the session should close
  // (whitespace was typed, or the caret moved back before the trigger).
  function extractQuery(text, startIndex, caretIndex) {
    if (caretIndex <= startIndex) return null;
    const query = text.slice(startIndex + 1, caretIndex);
    if (/\s/.test(query)) return null;
    return query;
  }

  // Computes the result of replacing text[startIndex:caretIndex] (the
  // "/query" the trigger opened on) with a block's template, plus where the
  // caret/selection should land afterwards - the template's first {{token}}
  // if it has one, else just past the inserted text.
  function buildInsertion(text, startIndex, caretIndex, template) {
    const before = text.slice(0, startIndex);
    const after = text.slice(caretIndex);
    const newText = before + template + after;
    const placeholder = PLACEHOLDER_RE.exec(template);
    const selectionStart = placeholder ? startIndex + placeholder.index : startIndex + template.length;
    const selectionEnd = placeholder ? selectionStart + placeholder[0].length : selectionStart;
    return { newText, selectionStart, selectionEnd };
  }

  // Finds the next {{token}} at or after fromIndex, wrapping around to the
  // start of the document if none is found before the end - so Tab cycles
  // through every remaining placeholder rather than stopping at the last one.
  function findNextPlaceholder(text, fromIndex) {
    PLACEHOLDER_RE_G.lastIndex = 0;
    let match;
    let firstMatch = null;
    while ((match = PLACEHOLDER_RE_G.exec(text))) {
      if (firstMatch === null) firstMatch = match;
      if (match.index >= fromIndex) {
        return { start: match.index, end: match.index + match[0].length };
      }
    }
    return firstMatch ? { start: firstMatch.index, end: firstMatch.index + firstMatch[0].length } : null;
  }

  function attach(textarea, options) {
    const getBlocks = (options && options.getBlocks) || global.CodexBlocks.getBlocks;
    const filterBlocks = (options && options.filterBlocks) || global.CodexBlocks.filterBlocks;
    const getCaretCoords = (options && options.getCaretCoords) || (global.CodexCaretPosition && global.CodexCaretPosition.getCaretCoords);

    let session = null; // { startIndex } while the menu is open
    let items = [];
    let activeIndex = 0;
    let placeholderModeActive = false;

    const menu = document.createElement('div');
    menu.className = 'slash-menu';
    menu.style.display = 'none';
    document.body.appendChild(menu);

    // Without this, clicking a menu item blurs the textarea first (which
    // closes the menu) before the click ever registers.
    menu.addEventListener('mousedown', (e) => e.preventDefault());

    function close() {
      session = null;
      items = [];
      activeIndex = 0;
      menu.style.display = 'none';
      menu.innerHTML = '';
    }

    function renderItems() {
      if (items.length === 0) {
        menu.innerHTML = '<div class="slash-menu-empty">No matching blocks</div>';
        return;
      }
      menu.innerHTML = items
        .map(
          (block, i) => `
            <div class="slash-menu-item${i === activeIndex ? ' is-active' : ''}" data-index="${i}">
              <span class="slash-menu-item-icon">${block.icon}</span>
              <span class="slash-menu-item-label">${block.label}</span>
            </div>`
        )
        .join('');
    }

    function render(query) {
      items = filterBlocks(query);
      activeIndex = 0;
      renderItems();
    }

    function setActiveIndex(index) {
      if (items.length === 0) return;
      activeIndex = (index + items.length) % items.length;
      renderItems();
    }

    function open(startIndex) {
      session = { startIndex };
      const coords = getCaretCoords ? getCaretCoords(textarea) : null;
      if (coords) {
        menu.style.left = `${coords.left}px`;
        menu.style.top = `${coords.top + coords.lineHeight}px`;
      } else {
        const rect = textarea.getBoundingClientRect();
        menu.style.left = `${rect.left + window.scrollX}px`;
        menu.style.top = `${rect.top + window.scrollY}px`;
      }
      menu.style.display = 'block';
      render('');
    }

    function insertBlock(block) {
      const text = textarea.value;
      const caret = textarea.selectionStart;
      const startIndex = session.startIndex;
      const { selectionStart, selectionEnd } = buildInsertion(text, startIndex, caret, block.template);

      textarea.focus();
      textarea.setSelectionRange(startIndex, caret);
      // execCommand keeps the browser's native undo/redo stack intact,
      // unlike assigning textarea.value directly which would wipe it.
      document.execCommand('insertText', false, block.template);
      textarea.setSelectionRange(selectionStart, selectionEnd);

      close();
      placeholderModeActive = PLACEHOLDER_RE.test(block.template);
    }

    textarea.addEventListener('input', () => {
      const text = textarea.value;
      const caret = textarea.selectionStart;

      if (session) {
        const query = extractQuery(text, session.startIndex, caret);
        if (query === null) {
          close();
        } else {
          render(query);
        }
        return;
      }

      if (isTriggerPosition(text, caret) && !isInsideFencedCode(text, caret - 1)) {
        open(caret - 1);
      }
    });

    textarea.addEventListener('keydown', (e) => {
      if (session) {
        if (e.key === 'Escape') {
          close();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          setActiveIndex(activeIndex + 1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          setActiveIndex(activeIndex - 1);
        } else if (e.key === 'Enter' || e.key === 'Tab') {
          if (items.length > 0) {
            e.preventDefault();
            insertBlock(items[activeIndex]);
          }
        }
        return;
      }

      if (placeholderModeActive && e.key === 'Tab' && !e.shiftKey) {
        const next = findNextPlaceholder(textarea.value, textarea.selectionEnd);
        if (next) {
          e.preventDefault();
          textarea.setSelectionRange(next.start, next.end);
        } else {
          placeholderModeActive = false;
        }
      }
    });

    // A manual click means the user is navigating on their own - stop
    // treating Tab as "jump to the next placeholder" from that point on.
    textarea.addEventListener('mousedown', () => {
      placeholderModeActive = false;
    });

    textarea.addEventListener('blur', close);

    menu.addEventListener('click', (e) => {
      const el = e.target.closest('.slash-menu-item');
      if (!el) return;
      const index = Number(el.dataset.index);
      insertBlock(items[index]);
    });

    document.addEventListener('mousedown', (e) => {
      if (!session) return;
      if (e.target === textarea || menu.contains(e.target)) return;
      close();
    });

    return { close };
  }

  const api = { attach, isTriggerPosition, isInsideFencedCode, extractQuery, buildInsertion, findNextPlaceholder };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CodexSlashMenu = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
