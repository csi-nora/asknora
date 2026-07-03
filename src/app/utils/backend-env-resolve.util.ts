import type { AppEnvironment } from '../models';

export interface BackendUrlOverrides {
  backendBaseUrl?: string;
}

/**
 * Effective CSI Nora gateway origin (no trailing slash).
 * YAML overrides beat build-time `environment`; when still empty in the browser,
 * use same-origin so `npm run demo` / production.cjs on :8080 hits `/api/llm/*`.
 */
export function resolveEffectiveBackendBaseUrl(
  base: AppEnvironment,
  overrides: BackendUrlOverrides = {},
): string {
  const fromYaml = (overrides.backendBaseUrl ?? '').trim();
  if (fromYaml) {
    return fromYaml.replace(/\/$/, '');
  }

  const fromEnv = (base.backendBaseUrl ?? '').trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    if (!base.production || base.preferTokenBackend) {
      return window.location.origin;
    }
  }

  return '';
}
