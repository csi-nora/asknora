/**
 * CSI Nora production environment.
 * Served behind the nginx reverse proxy (docker-compose.proxy.yml), so all
 * backend calls use relative path prefixes that nginx routes to each service.
 */
export const environment = {
  production: true,
  defaultProvider: 'ollama' as const,
  /** Proxied OpenAI-compatible Ollama API (nginx: location /ollama/) */
  ollamaBaseUrl: '/ollama/v1',
  ollamaDirectUrl: '/ollama/v1',
  /** Sandbox BFF bridge (nginx: location /sandbox/) */
  sandboxBridgeUrl: '/sandbox',
  /** Streamlit dashboard (nginx: location /streamlit/) */
  streamlitUrl: '/streamlit/',
  defaultOllamaModel: 'llama3.2:1b',
  defaultAccelDevice: 'auto' as const,
};
