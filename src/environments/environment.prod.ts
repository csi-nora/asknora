import type { AppEnvironment } from '../app/models';

/** Production build — no client-side tier override. */
export const environment: AppEnvironment = {
  production: true,
  deploymentTier: 'production',
  allowUatOverride: false,
  appVersion: '4.2.0',
  /** Replace with your production API gateway origin in CI/CD (no trailing slash). */
  backendBaseUrl: '',
  /** Production: prefer CSI Nora token/gateway backend; set `backendBaseUrl` to your gateway origin. */
  preferTokenBackend: true,
};
