// Converts an uploaded PDF into the same {description, screenshot} step
// shape sops.steps already uses for extension-captured SOPs (see
// public/new-document.html's renderSteps()), so a leadership-authored PDF
// keeps its inline screenshots/diagrams instead of being flattened to bare
// text.
//
// Uses mupdf (github.com/ArtifexSoftware/mupdf.js) rather than a
// canvas-based renderer (pdfjs-dist + node-canvas/poppler) because it ships
// as a self-contained WASM build with no native compile step - important
// since this app has no Dockerfile/nixpacks.toml to install system
// packages like poppler-utils or cairo on deploy.
//
// mupdf is ESM-only with top-level await, so it can't be require()'d from
// this CommonJS codebase - it's loaded once via dynamic import() and cached.
let mupdfPromise = null;
function loadMupdf() {
  if (!mupdfPromise) mupdfPromise = import('mupdf');
  return mupdfPromise;
}

const MAX_PAGES = 75;
const RENDER_DPI = 150;
const JPEG_QUALITY = 78;

class PdfImportError extends Error {}

// A PDF's actual step boundaries rarely line up with its page boundaries -
// a page might hold three short steps, or one step might spill onto a
// second page. So rather than always treating "one page" as "one step",
// this scans the extracted text for an explicit numbered structure
// ("Step 1", "1.", "1)") and splits on that when it finds one, only
// falling back to one-step-per-page when it can't find a confident match.
//
// "Confident" here means at least two hits whose numbers strictly increase
// in reading order and start at 1 or 2 - guards against a numbered list in
// a table of contents (which would repeat 1..N a second time in the body,
// breaking strict increase across the whole document) or incidental
// numbers ("24-hour", a page number, a measurement) that don't form a
// run. A real fix-up of a bad guess is still one click away in the step
// editor, so this only needs to be right often enough to save the common
// case of retyping an already-numbered procedure.
const HEADING_PATTERNS = [
  /^\s*step\s+(\d{1,3})\b[:.\-)]?\s*/i,
  /^\s*(\d{1,3})[.)]\s+\S/,
];

function findHeadingMatches(lines, pattern) {
  const matches = [];
  lines.forEach((line, index) => {
    const m = pattern.exec(line.text);
    if (m) matches.push({ index, page: line.page, num: parseInt(m[1], 10) });
  });
  if (matches.length < 2) return null;
  if (matches[0].num > 2) return null;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i].num <= matches[i - 1].num) return null;
  }
  return matches;
}

function detectSteps(pages) {
  const lines = [];
  pages.forEach((page, pageIndex) => {
    page.text.split('\n').forEach((text) => lines.push({ page: pageIndex, text }));
  });

  let matches = null;
  for (const pattern of HEADING_PATTERNS) {
    matches = findHeadingMatches(lines, pattern);
    if (matches) break;
  }

  if (!matches) {
    return {
      detected: 'pages',
      steps: pages.map((page) => ({ description: page.text.trim(), screenshot: page.screenshot })),
    };
  }

  const steps = [];
  const sliceText = (start, end) =>
    lines.slice(start, end).map((l) => l.text).join('\n').trim();

  if (matches[0].index > 0) {
    const leading = sliceText(0, matches[0].index);
    if (leading) steps.push({ description: leading, screenshot: pages[0].screenshot });
  }
  matches.forEach((match, i) => {
    const end = i + 1 < matches.length ? matches[i + 1].index : lines.length;
    steps.push({ description: sliceText(match.index, end), screenshot: pages[match.page].screenshot });
  });

  return { detected: 'headings', steps };
}

async function pdfToSteps(buffer, { filename } = {}) {
  const mupdf = await loadMupdf();

  let doc;
  try {
    doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  } catch (err) {
    throw new PdfImportError('Could not read that file as a PDF.');
  }

  const pageCount = doc.countPages();
  if (pageCount === 0) throw new PdfImportError('That PDF has no pages.');
  if (pageCount > MAX_PAGES) {
    throw new PdfImportError(`That PDF has ${pageCount} pages - split it up first (max ${MAX_PAGES} per import).`);
  }

  const zoom = RENDER_DPI / 72;
  const matrix = mupdf.Matrix.scale(zoom, zoom);
  const pages = [];

  for (let i = 0; i < pageCount; i++) {
    const page = doc.loadPage(i);
    const text = page.toStructuredText().asText();
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
    const jpeg = pixmap.asJPEG(JPEG_QUALITY, false);
    pages.push({ text, screenshot: Buffer.from(jpeg).toString('base64') });
  }

  const { detected, steps } = detectSteps(pages);

  const metaTitle = (doc.getMetaData && doc.getMetaData('info:Title')) || '';
  const fallbackTitle = filename ? filename.replace(/\.pdf$/i, '') : '';
  const title = metaTitle.trim() || fallbackTitle.trim() || 'Imported PDF';

  return { title, steps, detected };
}

module.exports = { pdfToSteps, PdfImportError, MAX_PAGES };
