// Zips the extension's source files exactly as the Chrome Web Store wants
// them for a new listing version: a plain zip, unsigned, no "key" field (the
// Store assigns/keeps the listing's real ID itself - that's the
// capicbafpiflgbopfcklobgdebodigmb baked into public/dashboard.html).
//
// Different from scripts/pack-extension.js (which signs a CRX for the
// self-hosted update channel) and scripts/build-unpacked.js (which stages a
// local dev build with a fixed dev key) - this one ships to the Store as-is.
//
// Output: dist/codex-<version>-webstore.zip (gitignored, regenerated fresh
// on every build).
//
// Usage: node scripts/build-webstore.js

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

const ROOT = path.join(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const DIST_DIR = path.join(ROOT, 'dist');

// Exactly what manifest.json actually references - not the backend, not
// public/, not node_modules. review.js is dead code (nothing loads it since
// scale.js replaced it) and deliberately left out.
const EXTENSION_ENTRIES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'review.html',
  'scale.js',
  'config.js',
  'Icons',
];

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
  if (manifest.key) {
    throw new Error('extension/manifest.json has a "key" field - Store submissions must not include one');
  }

  fs.mkdirSync(DIST_DIR, { recursive: true });
  const outPath = path.join(DIST_DIR, `codex-${manifest.version}-webstore.zip`);
  const output = fs.createWriteStream(outPath);
  const archive = archiver('zip', { zlib: { level: 9 } });

  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });

  archive.pipe(output);
  for (const entry of EXTENSION_ENTRIES) {
    const src = path.join(EXTENSION_DIR, entry);
    if (!fs.existsSync(src)) {
      throw new Error(`Expected extension file/folder missing: ${entry}`);
    }
    if (fs.statSync(src).isDirectory()) {
      archive.directory(src, entry);
    } else {
      archive.file(src, { name: entry });
    }
  }
  await archive.finalize();
  await done;

  console.log(`Packed Web Store zip v${manifest.version}`);
  console.log(`  -> dist/codex-${manifest.version}-webstore.zip (${archive.pointer()} bytes)`);
  console.log('Upload this file at the Chrome Web Store Developer Dashboard.');
}

main().catch((err) => {
  console.error('Web Store packing failed:', err.message);
  process.exitCode = 1;
});
