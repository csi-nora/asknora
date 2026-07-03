import type { AppEnvironment } from '../app/models';

/** UAT / pre-prod lane: sandbox APIs and data boundaries (build: `configuration=sandbox`). */
export const environment: AppEnvironment = {
  production: false,
  deploymentTier: 'sandbox',
  allowUatOverride: true,
  appVersion: '4.2.0',
  /** Replace with your sandbox API gateway origin in CI/CD (no trailing slash). */
  backendBaseUrl: '',
  preferTokenBackend: false,
};
