/**
 * Verify dist/csi-nora/browser/index.html references existing JS/CSS assets.
 * Prevents blank-screen deploys when index.html and hashed bundles are out of sync.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const browser = path.join(root, 'dist', 'csi-nora', 'browser');
const indexPath = path.join(browser, 'index.html');

function assetRefs(html) {
  const refs = new Set();
  const re = /(?:src|href)=["']([^"']+\.(?:js|css))["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const ref = m[1];
    if (!ref.startsWith('http')) {
      refs.add(ref.split('?')[0]);
    }
  }
  return [...refs];
}

if (!fs.existsSync(indexPath)) {
  console.error(`[validate:dist] Missing ${indexPath}\nRun: npm run build`);
  process.exit(1);
}

const html = fs.readFileSync(indexPath, 'utf8');
const missing = assetRefs(html).filter((ref) => !fs.existsSync(path.join(browser, ref)));

if (missing.length) {
  console.error('[validate:dist] index.html references missing bundles:');
  for (const ref of missing) {
    console.error(`  - ${ref}`);
  }
  console.error('\nRebuild the SPA so index.html and hashed files match:\n  npm run build');
  process.exit(1);
}

if (!/main-[A-Z0-9]+\.js/.test(html)) {
  console.error('[validate:dist] index.html has no main-*.js entry — rebuild required.');
  process.exit(1);
}

console.log('[validate:dist] OK — SPA bundles match index.html');
