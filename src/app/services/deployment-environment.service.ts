import { Injectable, computed, inject, signal } from '@angular/core';
import { AppEnvironment, DeploymentTier } from '../models';
import { APP_ENVIRONMENT } from '../tokens/environment.token';

const LS_UAT_TIER = 'csinora_uat_deployment_tier';

/**
 * Effective deployment tier: build-time `environment.deploymentTier`, optionally overridden in-browser for UAT
 * when `allowUatOverride` is true (never in production builds).
 */
@Injectable({ providedIn: 'root' })
export class DeploymentEnvironmentService {
  private readonly env = inject(APP_ENVIRONMENT);

  /** Effective tier after optional UAT override */
  readonly tier = signal<DeploymentTier>(this.resolveInitial());

  readonly isProduction = computed(() => this.tier() === 'production');
  readonly isSandbox = computed(() => this.tier() === 'sandbox');

  /** Badge label for header */
  readonly tierLabel = computed(() =>
    this.tier() === 'production' ? 'PRODUCTION' : 'SANDBOX',
  );

  /** Short hint for tooltips / audit */
  readonly tierSummary = computed(() => {
    const t = this.tier();
    const base = this.env.deploymentTier;
    const overridden = t !== base;
    return overridden ? `UAT override: ${t} (build default: ${base})` : `Build tier: ${t}`;
  });

  private resolveInitial(): DeploymentTier {
    const base = this.env.deploymentTier;
    if (!this.env.allowUatOverride) {
      return base;
    }
    try {
      const raw = localStorage.getItem(LS_UAT_TIER);
      if (raw === 'production' || raw === 'sandbox') {
        return raw;
      }
    } catch {
      /* ignore */
    }
    return base;
  }

  /** UAT only: persist tier in localStorage and update signal */
  setUatTier(tier: DeploymentTier): void {
    if (!this.env.allowUatOverride) {
      return;
    }
    try {
      localStorage.setItem(LS_UAT_TIER, tier);
    } catch {
      /* ignore */
    }
    this.tier.set(tier);
  }

  clearUatOverride(): void {
    if (!this.env.allowUatOverride) {
      return;
    }
    try {
      localStorage.removeItem(LS_UAT_TIER);
    } catch {
      /* ignore */
    }
    this.tier.set(this.env.deploymentTier);
  }

  get buildEnvironment(): AppEnvironment {
    return this.env;
  }
}
