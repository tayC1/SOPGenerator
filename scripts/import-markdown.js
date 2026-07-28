// One-off admin script: bulk-migrates a directory of markdown files into
// CODEX as freeform reference documents (sops.doc_type = 'document') - for
// moving an old wiki/Notion/Confluence export in wholesale rather than
// pasting each page in by hand through /documents/new.
//
// Each file may start with a simple frontmatter block (flat "key: value"
// pairs, not full YAML - no nesting/lists, but quoted values are
// unquoted) to override its metadata:
//
//   ---
//   title: Expense Reimbursement Policy
//   category: Finance
//   description: One-line summary shown on the card
//   author: Jane Doe
//   public: true
//   created_at: 2023-04-01
//   updated: 2023-06-15
//   ---
//   # The actual markdown body starts here...
//
// Any field can be omitted, and a few common alternate spellings are
// accepted as aliases for the same thing:
//   category:    also accepts "dept" / "department"
//   public:      also accepts "visibility" - only an explicit
//                public/everyone/all/external value counts as public;
//                anything else (e.g. "finance-only", "internal") is
//                treated as private, same as omitting it entirely, so a
//                visibility scheme this script doesn't recognize fails
//                closed instead of accidentally exposing something.
//   created_at:  also accepts "created"
//   updated:     also accepts "updated_at"
// Fields with no CODEX equivalent (e.g. "tag", "pinned") are parsed but
// have nowhere to go, so they're silently dropped.
//
// A missing title falls back to the file's first "# Heading" line, then
// to its filename. A missing category falls back to --category. A
// missing public/visibility falls back to --public.
//
// Ownership: sops.user_id is a required foreign key, so every imported
// document needs an owner - pass an existing CODEX user's email with
// --user. That person becomes able to edit/delete the imported docs
// afterward (see routes/sops.js's PATCH/DELETE scoping). If they haven't
// signed in yet, run scripts/import-google-users.js first.
//
// Images: a markdown image reference (![alt](src)) pointing at a local
// file - root-relative like "/assets/x.png" (resolved against --dir), or
// relative to the markdown file itself like "./images/x.png" - is read
// off disk and inlined as a base64 data: URI, since a document's content
// is just a text column with nowhere else to host a sibling image file
// (this matches how SOP step screenshots are already stored as inline
// base64 elsewhere in this app). http(s) and already-inlined data: URIs
// are left untouched. A reference that can't be resolved (file missing,
// unrecognized extension) is left as-is and reported as a warning.
//
// Usage:
//   node scripts/import-markdown.js --dir ./legacy-docs --user you@kramer.pro
//   node scripts/import-markdown.js --dir ./legacy-docs --user you@kramer.pro --apply
//   node scripts/import-markdown.js --dir ./legacy-docs --user you@kramer.pro --category Finance --public --apply
//
// --fix-images: re-scans --dir and, for any file whose (exact, unique)
// title matches an existing doc_type='document' row, re-embeds its
// images and overwrites just that row's `content` - use this to backfill
// images into documents that were already imported before this script
// supported inlining them. --user is not needed in this mode, since it
// only updates existing rows rather than creating new ones.
//   node scripts/import-markdown.js --dir ./legacy-docs --fix-images
//   node scripts/import-markdown.js --dir ./legacy-docs --fix-images --apply

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const APPLY = process.argv.includes('--apply');
const FIX_IMAGES = process.argv.includes('--fix-images');
const DEFAULT_PUBLIC = process.argv.includes('--public');
const DIR = arg('dir');
const USER_EMAIL = arg('user');
const DEFAULT_CATEGORY = arg('category');

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
  }
  return out;
}

// A value wrapped in matching quotes (as YAML frontmatter commonly is,
// e.g. title: "How to Process Payroll") has those quotes stripped -
// otherwise they'd end up as literal characters in the saved title.
function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

// Minimal frontmatter parser - flat "key: value" pairs between a leading
// and trailing "---" line. Returns { meta, body }; meta is {} and body is
// the whole file when there's no frontmatter block.
function parseFrontmatter(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines[0].trim() !== '---') return { meta: {}, body: raw };

  const meta = {};
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i].trim() === '---') break;
    const match = lines[i].match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (match) meta[match[1].trim().toLowerCase()] = unquote(match[2]);
  }
  const body = lines.slice(i + 1).join('\n');
  return { meta, body };
}

// Lowercased in the middle of a title, same as this file's own headings
// above ("How do we Hire?" aside, this is the common convention) - not
// applied to the first or last word, so "To" in "How To" still gets
// capitalized when it opens or closes a title.
const TITLE_CASE_MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in',
  'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet', 'vs',
]);

function toTitleCase(text) {
  const words = text.split(' ').filter(Boolean);
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i > 0 && i < words.length - 1 && TITLE_CASE_MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

// A heading pulled out of the markdown body still has its markdown syntax
// in it (e.g. "# **Payroll** Guide") - strip that so the saved title is
// plain text instead of literal asterisks/brackets.
function stripInlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

function deriveTitle(meta, body, filePath) {
  if (meta.title) return meta.title.trim();

  // H1 first, but fall back to H2/H3 - plenty of files use a smaller
  // heading as their effective title instead of a true H1.
  const heading = body.match(/^#{1,3}\s+(.+)$/m);
  if (heading) return stripInlineMarkdown(heading[1]);

  const base = path
    .basename(filePath, path.extname(filePath))
    .replace(/^\d{4}-\d{2}-\d{2}[-_]?/, '') // leading date prefix, e.g. "2023-04-01-notes"
    .replace(/^\d+[-_]+/, '') // leading numeric prefix, e.g. "01-getting-started"
    .replace(/[-_]+/g, ' ')
    .trim();
  return base ? toTitleCase(base) : 'Untitled';
}

function parseBool(value, fallback) {
  if (value == null || value === '') return fallback;
  return /^(true|yes|1)$/i.test(String(value).trim());
}

// public: is explicit true/false. visibility: is a free-text scheme
// (e.g. "finance-only", "public", "internal") - only recognized
// public-ish values count as public; anything else, known or not, is
// treated as private so an unrecognized scheme fails closed rather than
// accidentally exposing scoped content.
function resolveIsPublic(meta, fallback) {
  if (meta.public != null && meta.public !== '') return parseBool(meta.public, fallback);
  if (meta.visibility) return /^(public|everyone|all|external)$/i.test(meta.visibility.trim());
  return fallback;
}

function parseDate(value, fallback) {
  if (!value) return fallback;
  const d = new Date(value);
  return isNaN(d.getTime()) ? fallback : d;
}

// Rewrites markdown image references pointing at a local file into
// inline base64 data: URIs - see the file-header comment for why. `warn`
// is called with a plain-English reason for anything left unresolved.
function inlineLocalImages(body, filePath, rootDir, warn) {
  return body.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (match, prefix, src, suffix) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return match; // already http(s)/data/etc - leave alone

    const resolved = src.startsWith('/') ? path.join(rootDir, src) : path.join(path.dirname(filePath), src);
    const mime = IMAGE_MIME_BY_EXT[path.extname(resolved).toLowerCase()];

    if (!mime) {
      warn(`unrecognized image type "${src}" - left as-is (won't display)`);
      return match;
    }
    if (!fs.existsSync(resolved)) {
      warn(`image not found on disk: "${src}" (looked for ${resolved}) - left as-is (won't display)`);
      return match;
    }

    const bytes = fs.readFileSync(resolved);
    if (bytes.length > 5 * 1024 * 1024) {
      warn(`image "${src}" is ${(bytes.length / 1024 / 1024).toFixed(1)}MB - embedding anyway, but consider shrinking it`);
    }
    return `${prefix}data:${mime};base64,${bytes.toString('base64')}${suffix}`;
  });
}

async function main() {
  if (!DIR || (!USER_EMAIL && !FIX_IMAGES)) {
    console.error('Usage: node scripts/import-markdown.js --dir <path> --user <email> [--category <name>] [--public] [--apply]');
    console.error('       node scripts/import-markdown.js --dir <path> --fix-images [--apply]');
    process.exitCode = 1;
    return;
  }

  const owner = FIX_IMAGES ? null : await (async () => {
    const userResult = await db.query('SELECT id, name FROM users WHERE email = $1', [USER_EMAIL]);
    if (userResult.rows.length === 0) {
      throw new Error(`No CODEX user found with email ${USER_EMAIL} - they need to have signed in at least once (or run scripts/import-google-users.js first).`);
    }
    return userResult.rows[0];
  })();

  // Category matching is exact-string everywhere else in CODEX (team
  // pages, admin scoping, PATCH/DELETE permission checks), so a
  // frontmatter value that only differs in case (e.g. "finance" vs the
  // real department "Finance") would silently orphan the doc from its
  // department instead of erroring. Resolve against the real department
  // names case-insensitively so casing differences don't matter.
  const departmentsResult = await db.query('SELECT name FROM departments');
  const departmentByLowerName = new Map(departmentsResult.rows.map((d) => [d.name.toLowerCase(), d.name]));

  const files = walk(DIR);
  console.log(`Found ${files.length} markdown file(s) under ${DIR}.`);
  console.log(APPLY ? 'Applying changes to the database...' : 'Dry run - pass --apply to write changes.');
  console.log('');

  let imported = 0;
  let failed = 0;

  for (const filePath of files) {
    const rel = path.relative(DIR, filePath);
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const { meta, body: rawBody } = parseFrontmatter(raw);
      const warn = (msg) => console.warn(`  [warn] ${rel}: ${msg}`);
      const body = inlineLocalImages(rawBody, filePath, DIR, warn);

      const title = deriveTitle(meta, body, filePath);
      const content = body.trim();

      if (!content) {
        console.log(`  [skip] ${rel} - empty after stripping frontmatter`);
        failed++;
        continue;
      }

      if (FIX_IMAGES) {
        const existing = await db.query(
          "SELECT id, content FROM sops WHERE doc_type = 'document' AND title = $1",
          [title]
        );
        if (existing.rows.length === 0) {
          console.log(`  [skip] ${rel} - no existing document titled "${title}"`);
          failed++;
          continue;
        }
        if (existing.rows.length > 1) {
          warn(`${existing.rows.length} existing documents share the title "${title}" - skipped, ambiguous which to update`);
          failed++;
          continue;
        }
        const row = existing.rows[0];
        if (row.content === content) {
          console.log(`  [unchanged] "${title}" - already up to date`);
          continue;
        }
        if (!APPLY) {
          console.log(`  [dry run] would update images in "${title}" (id ${row.id})`);
          imported++;
          continue;
        }
        await db.query('UPDATE sops SET content = $1, updated_at = NOW() WHERE id = $2', [content, row.id]);
        console.log(`  updated images in "${title}" (id ${row.id})`);
        imported++;
        continue;
      }

      const rawCategory = meta.category || meta.dept || meta.department || DEFAULT_CATEGORY || null;
      const category = rawCategory ? (departmentByLowerName.get(rawCategory.toLowerCase()) || rawCategory) : null;
      if (rawCategory && category === rawCategory && !departmentByLowerName.has(rawCategory.toLowerCase())) {
        warn(`category "${rawCategory}" doesn't match any existing department - saved as-is, but it won't show up on a team page or be manageable by that department's admins until the name matches exactly.`);
      }
      const description = meta.description || null;
      const url = meta.url || null;
      const author = meta.author || owner.name || null;
      const isPublic = resolveIsPublic(meta, DEFAULT_PUBLIC);
      const createdAt = parseDate(meta.created_at || meta.created, new Date());
      const updatedAt = parseDate(meta.updated || meta.updated_at, createdAt);

      if (!APPLY) {
        console.log(`  [dry run] would import "${title}" (category=${category || 'Uncategorized'}, public=${isPublic}) from ${rel}`);
        imported++;
        continue;
      }

      await db.query(
        `INSERT INTO sops (user_id, title, url, description, steps, author, category, created_date, doc_type, content, created_at, updated_at, is_public)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'document', $9, $10, $11, $12)`,
        [owner.id, title, url, description, JSON.stringify([]), author, category, createdAt, content, createdAt, updatedAt, isPublic]
      );
      console.log(`  imported "${title}" from ${rel}`);
      imported++;
    } catch (err) {
      console.error(`  [error] ${rel}: ${err.message}`);
      failed++;
    }
  }

  console.log('');
  if (APPLY) {
    console.log(`Done. ${FIX_IMAGES ? 'Updated' : 'Imported'} ${imported}, failed ${failed}.`);
  } else {
    console.log(`Done. ${imported} file(s) would be ${FIX_IMAGES ? 'updated' : 'imported'} (${failed} skipped) - rerun with --apply to write them.`);
  }
}

main()
  .catch((err) => {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
