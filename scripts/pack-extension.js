// Packs the Chrome extension's actual source files (NOT the whole repo -
// this is a Node/Express backend + a Chrome extension living side by side)
// into a signed CRX3 file, plus the Omaha-format update manifest Chrome
// polls to check for new versions.
//
// Runs identically on a local machine and inside Railway's build
// container - it's pure JS (via the `crx` package), so it never shells out
// to a real Chrome binary.
//
// Signing key resolution (in order):
//   1. EXTENSION_SIGNING_KEY env var (full PEM text) - what Railway uses.
//      Set this in the Railway project's variables, pasting the exact
//      contents of extension-key.pem. Never commit that file.
//   2. ./extension-key.pem on disk - local dev convenience.
// The key must stay the same forever, or the extension ID changes and
// every installed copy breaks (silently stops receiving updates, and the
// sign-in bridge in dashboard.html/background.js - which hardcodes the ID -
// stops working entirely).
//
// Output: dist/codex.crx, dist/updates.xml (both gitignored, regenerated
// fresh on every build).
//
// Usage: node scripts/pack-extension.js

const fs = require('fs');
const path = require('path');
const ChromeExtension = require('crx');

const ROOT = path.join(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const STAGING_DIR = path.join(ROOT, '.extension-build');
const DIST_DIR = path.join(ROOT, 'dist');
const UPDATE_BASE_URL = 'https://codex.kramer.pro';

// Exactly the files manifest.json actually references - not the backend,
// not public/, not node_modules. review.js is dead code (nothing loads it
// since scale.js replaced it) and deliberately left out.
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

function loadPrivateKey() {
  if (process.env.EXTENSION_SIGNING_KEY) {
    return process.env.EXTENSION_SIGNING_KEY;
  }
  const keyPath = path.join(ROOT, 'extension-key.pem');
  if (fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, 'utf8');
  }
  throw new Error(
    'No signing key found. Set EXTENSION_SIGNING_KEY (full PEM text) or place extension-key.pem at the repo root. ' +
    'Do NOT generate a new key - the extension ID must stay stable across updates.'
  );
}

function stageExtensionFiles() {
  fs.rmSync(STAGING_DIR, { recursive: true, force: true });
  fs.mkdirSync(STAGING_DIR, { recursive: true });

  for (const entry of EXTENSION_ENTRIES) {
    const src = path.join(EXTENSION_DIR, entry);
    if (!fs.existsSync(src)) {
      throw new Error(`Expected extension file/folder missing: ${entry}`);
    }
    fs.cpSync(src, path.join(STAGING_DIR, entry), { recursive: true });
  }
}

async function main() {
  const privateKey = loadPrivateKey();

  stageExtensionFiles();

  const crx = new ChromeExtension({
    privateKey,
    codebase: `${UPDATE_BASE_URL}/extension/codex.crx`,
  });

  await crx.load(STAGING_DIR);
  const crxBuffer = await crx.pack();
  const updateXml = crx.generateUpdateXML();
  const appId = crx.generateAppId();

  fs.mkdirSync(DIST_DIR, { recursive: true });
  fs.writeFileSync(path.join(DIST_DIR, 'codex.crx'), crxBuffer);
  fs.writeFileSync(path.join(DIST_DIR, 'updates.xml'), updateXml);

  fs.rmSync(STAGING_DIR, { recursive: true, force: true });

  console.log(`Packed extension v${crx.manifest.version} (id: ${appId})`);
  console.log(`  -> dist/codex.crx (${crxBuffer.length} bytes)`);
  console.log(`  -> dist/updates.xml`);
}

main().catch((err) => {
  console.error('Extension packing failed:', err.message);
  process.exitCode = 1;
});
