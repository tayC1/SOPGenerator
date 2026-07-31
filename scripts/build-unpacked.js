// Stages the extension's source files into dist/unpacked/ for local dev via
// Chrome's "Load unpacked" - no signing, no CRX, no update manifest, since
// unpacked loads don't go through any of that.
//
// The manifest's "name" gets an " (Unpacked)" suffix so the dev build is
// visually distinguishable from the Web Store / self-hosted installs in
// chrome://extensions and in the toolbar tooltip - same underlying code,
// different label so you know which copy you're looking at.
//
// It also gets a "key" field (DEV_PUBLIC_KEY below - just a public key, no
// signing capability, so nothing sensitive) so Chrome derives the same fixed
// extension ID (DEV_EXTENSION_ID) every time it's loaded instead of a
// random one per machine/path. dashboard.html's sign-in bridge knows this ID
// and tries it as a fallback, so sign-in reaches this build without hand-
// copying an ID out of chrome://extensions.
//
// Output: dist/unpacked/ (gitignored, regenerated fresh on every build).
//
// Usage: node scripts/build-unpacked.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const OUT_DIR = path.join(ROOT, 'dist', 'unpacked');

// Public key only - keeps "Load unpacked" extension ID stable across
// rebuilds. Corresponds to DEV_EXTENSION_ID = hjmljeciibdcngnbhganckgekhnoickn
// in public/dashboard.html. Not used for signing anything, so it's fine to
// commit (unlike extension-key.pem, which does sign the self-hosted CRX).
const DEV_PUBLIC_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxxQnGVXyWpdd50zRYTirSbta5JIF4eLznwtufSdNwG+RXEBkUaiKvuyaFBI9NKBpym3dOlo9DMsj2hN7onspfxsILdr3jc0lemU4bb6PV/LWL6jhXtuuaTXJFX7SrdL0SnW4yLqAseKLA7xHAvuEkUzjgsgd9W5UL2HgLnwB6THxWXrdTf/5awPb2+cBHMF2v4Yzil+apYvguAlMDE44kfvF4/2eKaDv7DGNDngy964N2/vw3oReOGIZFbZoPEk4parM21wHoMhtsUi/loeVHCViizRENNZjwJn+KqzN0xvsME0qn1JPtFGBYtdIl7ZI+bQKHNd28CyskWosEBDC4QIDAQAB';

// Same entries pack-extension.js ships - not the backend, not public/, not
// node_modules. review.js is dead code (nothing loads it since scale.js
// replaced it) and deliberately left out.
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

function main() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const entry of EXTENSION_ENTRIES) {
    const src = path.join(EXTENSION_DIR, entry);
    if (!fs.existsSync(src)) {
      throw new Error(`Expected extension file/folder missing: ${entry}`);
    }
    fs.cpSync(src, path.join(OUT_DIR, entry), { recursive: true });
  }

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.name = `${manifest.name} (Unpacked)`;
  manifest.key = DEV_PUBLIC_KEY;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`Staged unpacked build v${manifest.version} as "${manifest.name}"`);
  console.log(`  -> dist/unpacked/`);
  console.log('  -> extension ID: hjmljeciibdcngnbhganckgekhnoickn (fixed, matches dashboard.html)');
  console.log('Load via chrome://extensions -> Load unpacked -> select dist/unpacked');
}

main();
