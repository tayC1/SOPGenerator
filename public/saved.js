// Shared pin/save state, used by every page that renders a SOP card or the
// SOP detail view (dashboard, browse, team pages, sop.html, saved.html).
// Kept as one shared script - same convention as markdown.js - instead of
// copy-pasting this fetch/toggle logic into each page.
//
// Bookmark icon markup is exported too (outline = unsaved, filled = saved)
// so every page renders the exact same pin glyph.
const CodexSaved = (() => {
  let ids = new Set();

  const ICON_OUTLINE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>';
  const ICON_FILLED = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>';

  async function load() {
    try {
      const res = await fetch('/sops/saved-ids', { credentials: 'include' });
      ids = res.ok ? new Set(await res.json()) : new Set();
    } catch {
      ids = new Set();
    }
    return ids;
  }

  function isSaved(id) {
    return ids.has(Number(id));
  }

  function icon(id) {
    return isSaved(id) ? ICON_FILLED : ICON_OUTLINE;
  }

  // Flips the pin for `id` and returns the new saved state. Throws on
  // failure so callers can decide how to surface it (alert, revert a
  // button, etc.) rather than this module guessing.
  async function toggle(id) {
    const wasSaved = isSaved(id);
    const res = await fetch(`/sops/${id}/save`, { method: wasSaved ? 'DELETE' : 'POST', credentials: 'include' });
    if (!res.ok) throw new Error('Failed to update saved state');
    if (wasSaved) ids.delete(Number(id));
    else ids.add(Number(id));
    return !wasSaved;
  }

  return { load, isSaved, toggle, icon, ICON_OUTLINE, ICON_FILLED };
})();
