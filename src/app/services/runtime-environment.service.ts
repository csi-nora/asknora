import { Injectable, inject } from '@angular/core';
import type { AppEnvironment } from '../models';
import { APP_ENVIRONMENT } from '../tokens/environment.token';
import { resolveEffectiveBackendBaseUrl } from '../utils/backend-env-resolve.util';
import { SecretsYamlVaultService } from './secrets-yaml-vault.service';

/**
 * Build-time `environment` merged with optional local YAML vault overrides.
 * Use this (not `APP_ENVIRONMENT` alone) for LLM URLs and gateway preference.
 */
@Injectable({ providedIn: 'root' })
export class RuntimeEnvironmentService {
  private readonly base = inject(APP_ENVIRONMENT);
  private readonly vault = inject(SecretsYamlVaultService);

  /** Effective environment for API calls and backend resolution. */
  effective(): AppEnvironment {
    const o = this.vault.getYamlOverrides();
    const preferTokenBackend = o.preferTokenBackend ?? this.base.preferTokenBackend;
    const backendBaseUrl = resolveEffectiveBackendBaseUrl(this.base, o);
    return {
      ...this.base,
      backendBaseUrl,
      preferTokenBackend,
    };
  }
}
