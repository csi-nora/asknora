/**
 * CSI Nora LLM gateway — proxies /api/llm/* to Anthropic, OpenAI, and Hugging Face.
 * Keys are read from the environment (never logged). Use with Angular `backendBaseUrl` pointing at this origin.
 *
 *   npm run gateway
 *
 * Defaults: PORT=3456. See server/.env.example
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');

const PORT = Number(process.env.PORT || 3456);

function stripClientSecrets(proxyReq) {
  proxyReq.removeHeader('authorization');
  proxyReq.removeHeader('x-api-key');
}

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: true }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'csi-nora-llm-gateway' });
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console -- startup banner
  console.log(`CSI Nora LLM gateway listening on http://127.0.0.1:${PORT}`);
});
