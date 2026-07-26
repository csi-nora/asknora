/**
 * CSI Nora runtime environment.
 * Local sandbox (ai-ecosystem-sandbox) is reached via Angular proxy in dev
 * to avoid browser CORS issues with Ollama.
 */
export const environment = {
  production: false,
  /** Default AI provider when no saved config exists */
  defaultProvider: 'ollama' as const,
  /** Proxied OpenAI-compatible Ollama API (see proxy.conf.json) */
  ollamaBaseUrl: '/ollama/v1',
  /** Direct host URL (docs / production builds without proxy) */
  ollamaDirectUrl: 'http://localhost:11434/v1',
  /** Optional sandbox BFF (device scale + guardrails) */
  sandboxBridgeUrl: '/sandbox',
  streamlitUrl: 'http://localhost:8501',
  defaultOllamaModel: 'llama3.2:3b',
  defaultAccelDevice: 'auto' as const,
};
