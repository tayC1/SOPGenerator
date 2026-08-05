function truncate(text, max) {
  if (!text) return '';
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function sopSnippet(sop) {
  return truncate(sop.description || sop.content, 160);
}

function metaLine(sop) {
  const typeLabel = sop.doc_type === 'document' ? 'Document' : 'SOP';
  const categoryLabel = sop.category ? ` · ${sop.category}` : '';
  return `${typeLabel}${categoryLabel}`;
}

function resultBlocks(sop, codexBaseUrl) {
  const snippet = sopSnippet(sop) || '_No description_';
  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `*${sop.title}*\n${snippet}\n_${metaLine(sop)}_` },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Share to channel' },
          action_id: 'share_to_channel',
          value: String(sop.id),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Open in CODEX' },
          action_id: 'open_in_codex',
          url: `${codexBaseUrl}/sop.html?id=${sop.id}`,
        },
      ],
    },
    { type: 'divider' },
  ];
}

function buildSearchResultBlocks(query, results, codexBaseUrl) {
  const header = {
    type: 'section',
    text: { type: 'mrkdwn', text: `Results for *"${query}"* (only visible to you):` },
  };
  // Slack caps messages at 50 blocks; each result is 3 blocks (section +
  // actions + divider) plus the header, so this also keeps us well under it.
  return [header, ...results.flatMap((sop) => resultBlocks(sop, codexBaseUrl))].slice(0, 50);
}

function buildNoResultsBlocks(query) {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `No CODEX results for *"${query}"*.` } },
  ];
}

function buildSignInRequiredBlocks(codexBaseUrl) {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Your Slack email isn't linked to a CODEX account yet. Sign in at <${codexBaseUrl}|${codexBaseUrl}> with your Kramer Pro Google account, then try \`/codex\` again.`,
      },
    },
  ];
}

function buildUsageBlocks() {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: 'Usage: `/codex <search terms>`' } },
  ];
}

function buildSharedSopBlocks(sop, codexBaseUrl, sharerName) {
  const snippet = sopSnippet(sop) || '_No description_';
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:memo: *<${codexBaseUrl}/sop.html?id=${sop.id}|${sop.title}>*\n${snippet}\n_${metaLine(sop)} · shared by ${sharerName}_`,
      },
    },
  ];
}

module.exports = {
  buildSearchResultBlocks,
  buildNoResultsBlocks,
  buildSignInRequiredBlocks,
  buildUsageBlocks,
  buildSharedSopBlocks,
};
