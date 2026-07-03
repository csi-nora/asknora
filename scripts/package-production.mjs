/**
 * Package CSI Nora for production deployment (offline bundle / VM handoff).
 *
 *   npm run package:prod
 *   npm run package:prod -- --origin https://your-host.example.com
 *
 * Output: release/csi-nora-<version>-<timestamp>/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

function readVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.version || '0.0.0';
}

function copyDir(src, dest, { skip = [] } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to, { skip });
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function copyFileIfExists(src, dest) {
  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

const originArg = process.argv.find((a) => a.startsWith('--origin='))?.split('=')[1]?.trim();
const version = readVersion();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(root, 'release', `csi-nora-${version}-${stamp}`);

console.log('[package:prod] Building production bundle…');
if (originArg) {
  process.env.CSI_NORA_PUBLIC_ORIGIN = originArg;
  execSync('npm run build:vm', { cwd: root, stdio: 'inherit' });
} else {
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
}

const browserSrc = path.join(root, 'dist', 'csi-nora', 'browser');
if (!fs.existsSync(browserSrc)) {
  console.error('[package:prod] Missing dist/csi-nora/browser — build failed?');
  process.exit(1);
}

console.log('[package:prod] Assembling release folder…');
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

copyDir(browserSrc, path.join(outDir, 'browser'));
copyDir(path.join(root, 'server'), path.join(outDir, 'server'), { skip: ['.env'] });
copyDir(path.join(root, 'deploy', 'docker'), path.join(outDir, 'deploy', 'docker'));
copyFileIfExists(path.join(root, 'deploy', 'vm-public-ip', 'nginx-csi-nora.conf'), path.join(outDir, 'deploy', 'nginx-csi-nora.conf'));
copyFileIfExists(path.join(root, 'netlify.toml'), path.join(outDir, 'netlify.toml'));
copyFileIfExists(path.join(root, 'package.json'), path.join(outDir, 'package.json'));
copyFileIfExists(path.join(root, 'package-lock.json'), path.join(outDir, 'package-lock.json'));

const runMd = `# CSI Nora — production release ${version}

Generated: ${new Date().toISOString()}
${originArg ? `Public origin (build): ${originArg}\n` : ''}

## Contents

| Path | Purpose |
|------|---------|
| \`browser/\` | Production Angular SPA (static files) |
| \`server/\` | LLM gateway + combined production server |
| \`deploy/docker/\` | Docker Compose stack (recommended) |
| \`deploy/nginx-csi-nora.conf\` | Sample nginx for VM / public IP |

## Option A — Docker (recommended)

\`\`\`bash
cp deploy/docker/.env.example server/.env   # add provider keys
docker compose -f deploy/docker/docker-compose.yml up --build -d
\`\`\`

Open **http://localhost:8080**

## Option B — Node single process

\`\`\`bash
cp server/.env.example server/.env          # add provider keys
npm ci --omit=dev
node server/production.cjs                 # serves browser/ + /api on PORT (default 8080)
\`\`\`

Copy \`browser/\` contents to match \`dist/csi-nora/browser\` layout, or run from repo root after \`npm run build\`.

## Option C — Static host only (Netlify / S3 / CloudFront)

Deploy \`browser/\` only. Users configure API keys in the browser, or set \`backendBaseUrl\` at build time.

## Option D — VM + nginx

1. Copy \`browser/\` to \`/var/www/csi-nora/browser\`
2. Use \`deploy/nginx-csi-nora.conf\` (adjust \`server_name\`, TLS)
3. Run \`node server/gateway.cjs\` (port 3456) with \`server/.env\`

## Health checks

- SPA: \`GET /\`
- API: \`GET /api/health\`

## Security

- Never commit \`server/.env\` with real keys
- Use HTTPS at the edge in production
- Limit CORS / ingress to known origins
`;

fs.writeFileSync(path.join(outDir, 'RUN-PRODUCTION.md'), runMd, 'utf8');

console.log('');
console.log('[package:prod] Release ready:');
console.log('  ', outDir);
console.log('[package:prod] Read RUN-PRODUCTION.md in that folder.');
console.log('');
