// Slash-command block menu for a plain <textarea> (used against
// contentInput in new-document.html). This first pass covers trigger
// detection, live filtering, and rendering/dismissing the floating menu.
// Caret-accurate positioning and actual block insertion land in the next
// pass - for now the menu opens under the textarea's top-left corner and
// clicking/selecting an item just closes it without touching the text.
//
// Exposes CodexSlashMenu.attach(textarea, options) in the browser, plus the
// pure helper functions (no DOM) via module.exports under Node for testing.
(function (global) {
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

  function attach(textarea, options) {
    const getBlocks = (options && options.getBlocks) || global.CodexBlocks.getBlocks;
    const filterBlocks = (options && options.filterBlocks) || global.CodexBlocks.filterBlocks;

    let session = null; // { startIndex } while the menu is open
    let items = [];

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
      menu.style.display = 'none';
      menu.innerHTML = '';
    }

    function render(query) {
      items = filterBlocks(query, getBlocks());
      if (items.length === 0) {
        menu.innerHTML = '<div class="slash-menu-empty">No matching blocks</div>';
        return;
      }
      menu.innerHTML = items
        .map(
          (block, i) => `
            <div class="slash-menu-item${i === 0 ? ' is-active' : ''}" data-index="${i}">
              <span class="slash-menu-item-icon">${block.icon}</span>
              <span class="slash-menu-item-label">${block.label}</span>
            </div>`
        )
        .join('');
    }

    function open(startIndex) {
      session = { startIndex };
      const rect = textarea.getBoundingClientRect();
      menu.style.left = `${rect.left + window.scrollX}px`;
      menu.style.top = `${rect.top + window.scrollY}px`;
      menu.style.display = 'block';
      render('');
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
      if (!session) return;
      if (e.key === 'Escape') {
        close();
      }
    });

    textarea.addEventListener('blur', close);

    menu.addEventListener('click', (e) => {
      const el = e.target.closest('.slash-menu-item');
      if (!el) return;
      close();
      textarea.focus();
    });

    document.addEventListener('mousedown', (e) => {
      if (!session) return;
      if (e.target === textarea || menu.contains(e.target)) return;
      close();
    });

    return { close };
  }

  const api = { attach, isTriggerPosition, isInsideFencedCode, extractQuery };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CodexSlashMenu = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
