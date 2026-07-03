import { TestBed } from '@angular/core/testing';
import { DeploymentEnvironmentService } from './deployment-environment.service';
import { APP_ENVIRONMENT } from '../tokens/environment.token';
import type { AppEnvironment } from '../models';

describe('DeploymentEnvironmentService', () => {
  const sandboxEnv: AppEnvironment = {
    production: false,
    deploymentTier: 'sandbox',
    allowUatOverride: true,
    appVersion: 'test',
    backendBaseUrl: '',
    preferTokenBackend: false,
  };

  const prodEnv: AppEnvironment = {
    production: true,
    deploymentTier: 'production',
    allowUatOverride: false,
    appVersion: 'test',
    backendBaseUrl: '',
    preferTokenBackend: true,
  };

  afterEach(() => {
    try {
      localStorage.removeItem('csinora_uat_deployment_tier');
    } catch {
      /* ignore */
    }
  });

  it('uses build tier when no UAT override', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: APP_ENVIRONMENT, useValue: sandboxEnv }, DeploymentEnvironmentService],
    });
    const svc = TestBed.inject(DeploymentEnvironmentService);
    expect(svc.tier()).toBe('sandbox');
    expect(svc.isSandbox()).toBe(true);
  });

  it('respects localStorage UAT override when allowed', () => {
    localStorage.setItem('csinora_uat_deployment_tier', 'production');
    TestBed.configureTestingModule({
      providers: [{ provide: APP_ENVIRONMENT, useValue: sandboxEnv }, DeploymentEnvironmentService],
    });
    const svc = TestBed.inject(DeploymentEnvironmentService);
    expect(svc.tier()).toBe('production');
    expect(svc.isProduction()).toBe(true);
  });

  it('ignores UAT override when production build', () => {
    localStorage.setItem('csinora_uat_deployment_tier', 'sandbox');
    TestBed.configureTestingModule({
      providers: [{ provide: APP_ENVIRONMENT, useValue: prodEnv }, DeploymentEnvironmentService],
    });
    const svc = TestBed.inject(DeploymentEnvironmentService);
    expect(svc.tier()).toBe('production');
  });

  it('setUatTier updates tier when override allowed', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: APP_ENVIRONMENT, useValue: sandboxEnv }, DeploymentEnvironmentService],
    });
    const svc = TestBed.inject(DeploymentEnvironmentService);
    svc.setUatTier('production');
    expect(svc.tier()).toBe('production');
    expect(localStorage.getItem('csinora_uat_deployment_tier')).toBe('production');
  });

  it('clearUatOverride restores build tier', () => {
    localStorage.setItem('csinora_uat_deployment_tier', 'production');
    TestBed.configureTestingModule({
      providers: [{ provide: APP_ENVIRONMENT, useValue: sandboxEnv }, DeploymentEnvironmentService],
    });
    const svc = TestBed.inject(DeploymentEnvironmentService);
    expect(svc.tier()).toBe('production');
    svc.clearUatOverride();
    expect(svc.tier()).toBe('sandbox');
  });
});
