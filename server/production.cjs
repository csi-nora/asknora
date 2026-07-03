/**
 * CSI Nora production server — static Angular SPA + LLM gateway on one port.
 *
 *   npm run build && npm run start:prod
 *
 * Serves dist/csi-nora/browser with SPA fallback and proxies /api/* to LLM providers
 * using keys from server/.env (never logged).
 *
 * Defaults: PORT=8080. See server/.env.example
 */
'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, '..', 'dist', 'csi-nora', 'browser');

function assetRefsFromIndex(html) {
  const refs = [];
  const re = /(?:src|href)=["']([^"']+\.(?:js|css))["']/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const ref = m[1];
    if (!ref.startsWith('http')) {
      refs.push(ref.split('?')[0]);
    }
  }
  return refs;
}

function validateSpaAssets() {
  const indexPath = path.join(ROOT, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return [`Missing ${indexPath} — run: npm run build`];
  }
  const html = fs.readFileSync(indexPath, 'utf8');
  const missing = assetRefsFromIndex(html).filter((ref) => !fs.existsSync(path.join(ROOT, ref)));
  if (!/main-[A-Z0-9]+\.js/.test(html)) {
    missing.push('main-*.js (Angular bootstrap bundle)');
  }
  return missing;
}

function stripClientSecrets(proxyReq) {
  proxyReq.removeHeader('authorization');
  proxyReq.removeHeader('x-api-key');
}

function mountGateway(app) {
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'csi-nora-production' });
  });

  app.use(
    '/api/llm/anthropic',
    createProxyMiddleware({
      target: 'https://api.anthropic.com',
      changeOrigin: true,
      pathRewrite: { '^/api/llm/anthropic': '' },
      onProxyReq: (proxyReq) => {
        stripClientSecrets(proxyReq);
        if (process.env.ANTHROPIC_API_KEY) {
          proxyReq.setHeader('x-api-key', process.env.ANTHROPIC_API_KEY);
        }
        proxyReq.setHeader('anthropic-version', '2023-06-01');
      },
    }),
  );

  app.use(
    '/api/llm/openai',
    createProxyMiddleware({
      target: 'https://api.openai.com',
      changeOrigin: true,
      pathRewrite: { '^/api/llm/openai': '' },
      onProxyReq: (proxyReq) => {
        stripClientSecrets(proxyReq);
        if (process.env.OPENAI_API_KEY) {
          proxyReq.setHeader('Authorization', `Bearer ${process.env.OPENAI_API_KEY}`);
        }
      },
    }),
  );

  app.use(
    '/api/llm/hf-inference',
    createProxyMiddleware({
      target: 'https://api-inference.huggingface.co',
      changeOrigin: true,
      pathRewrite: { '^/api/llm/hf-inference': '' },
      onProxyReq: (proxyReq) => {
        stripClientSecrets(proxyReq);
        if (process.env.HUGGINGFACE_API_KEY) {
          proxyReq.setHeader('Authorization', `Bearer ${process.env.HUGGINGFACE_API_KEY}`);
        }
      },
    }),
  );

  app.use(
    '/api/llm/hf-meta',
    createProxyMiddleware({
      target: 'https://huggingface.co',
      changeOrigin: true,
      pathRewrite: { '^/api/llm/hf-meta': '' },
      onProxyReq: (proxyReq) => {
        stripClientSecrets(proxyReq);
        if (process.env.HUGGINGFACE_API_KEY) {
          proxyReq.setHeader('Authorization', `Bearer ${process.env.HUGGINGFACE_API_KEY}`);
        }
      },
    }),
  );
}

function mountStatic(app) {
  if (!fs.existsSync(ROOT)) {
    // eslint-disable-next-line no-console
    console.error(
      `[production] Missing build output: ${ROOT}\n` +
        'Run: npm run build   (or npm run build:prod)',
    );
    process.exit(1);
  }

  const broken = validateSpaAssets();
  if (broken.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[production] Broken SPA build — index.html references missing files:\n` +
        broken.map((f) => `  - ${f}`).join('\n') +
        '\n\nThis causes a blank screen in the browser. Rebuild:\n  npm run build\n',
    );
    process.exit(1);
  }

  app.use(express.static(ROOT, { maxAge: '1d' }));

  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(ROOT, 'index.html'));
  });
}

const app = express();
app.disable('x-powered-by');
mountGateway(app);
mountStatic(app);

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`CSI Nora production server listening on http://0.0.0.0:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`  SPA root: ${ROOT}`);
  // eslint-disable-next-line no-console
  console.log('  LLM gateway: /api/llm/* (keys from server/.env)');
});
