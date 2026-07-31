// Static registry of slash-menu blocks for the SOP reference-document editor
// (public/new-document.html's contentInput textarea). Each block's
// `template` is Markdown text - rendered by markdown.js - with {{token}}
// placeholders the slash-menu lets you Tab through after insertion.
//
// getBlocks() is the seam meant to change when blocks move from this static
// list to team-editable rows in Postgres. Callers (slash-menu.js, tests)
// only ever go through getBlocks()/filterBlocks(), never read BLOCKS
// directly, so swapping this for an async fetch('/api/blocks') later is a
// one-line change here rather than a refactor of the menu code.
//
// Unlike markdown.js's browser-only IIFE, this also exports via
// module.exports when run under Node so scripts/tests/*.test.js can
// require() it directly without a DOM.
(function (global) {
  const BLOCKS = [
    {
      id: 'callout',
      label: 'Callout / warning box',
      icon: '⚠️',
      keywords: ['warning', 'callout', 'note', 'alert', 'caution'],
      template: '> ⚠️ **{{label}}:** {{text}}',
    },
    {
      id: 'prerequisites',
      label: 'Prerequisites list',
      icon: '✅',
      keywords: ['prerequisites', 'before you start', 'requirements', 'checklist'],
      template: '**Before you start:**\n- {{item}}\n- {{item}}\n- {{item}}',
    },
    {
      id: 'role-required',
      label: 'Role required tag',
      icon: '🔑',
      keywords: ['role', 'permission', 'access', 'you need'],
      template: '`You need: {{role}}`',
    },
    {
      id: 'step-group',
      label: 'Step group / numbered procedure',
      icon: '🔢',
      keywords: ['steps', 'procedure', 'numbered', 'process'],
      template: '**{{procedure name}}**\n1. {{step}}\n2. {{step}}\n3. {{step}}',
    },
    {
      id: 'screenshot',
      label: 'Screenshot placeholder',
      icon: '🖼️',
      keywords: ['screenshot', 'image', 'picture', 'screen'],
      template: '![{{alt text}}]({{image url}})',
    },
    {
      id: 'command',
      label: 'Command / code snippet',
      icon: '💻',
      keywords: ['command', 'code', 'snippet', 'terminal', 'cli'],
      template: '```\n{{command}}\n```',
    },
    {
      id: 'decision-branch',
      label: 'Decision branch',
      icon: '🔀',
      keywords: ['decision', 'branch', 'if', 'else', 'condition'],
      template: '**If {{condition}}:**\n- {{then}}\n\n**Else:**\n- {{otherwise}}',
    },
    {
      id: 'email',
      label: 'Email block',
      icon: '✉️',
      keywords: ['email', 'mail', 'to', 'subject'],
      template: '**To:** {{recipient}}\n**Subject:** {{subject}}\n\n{{body}}',
    },
  ];

  function getBlocks() {
    return BLOCKS;
  }

  // Prefix/substring match on the label plus a substring match against
  // keywords - fuzzy enough to find things without a fuzzy-match dependency.
  function filterBlocks(query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return BLOCKS;
    return BLOCKS.filter((block) => {
      if (block.label.toLowerCase().includes(q)) return true;
      return block.keywords.some((k) => k.toLowerCase().includes(q));
    });
  }

  const api = { getBlocks, filterBlocks };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    global.CodexBlocks = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
