import type { AppEnvironment } from '../app/models';

/** Local development — defaults to sandbox tier; UAT override allowed. */
export const environment: AppEnvironment = {
  production: false,
  deploymentTier: 'sandbox',
  allowUatOverride: true,
  appVersion: '4.2.0',
  /**
   * Empty + non-production: `RuntimeEnvironmentService` uses `window.location.origin` so
   * `/api/llm/*` hits the dev proxy → gateway (avoids browser CORS to OpenAI/HF).
   * Set `backendBaseUrl: ""` in YAML to force direct provider calls from the browser instead.
   */
  backendBaseUrl: '',
  preferTokenBackend: false,
};
