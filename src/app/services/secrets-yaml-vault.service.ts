import { inject, Injectable, signal } from '@angular/core';
import { StorageService } from './storage.service';
import { StateService } from './state.service';
import type { ApiProvider, AppEnvironment } from '../models';
import { APP_ENVIRONMENT } from '../tokens/environment.token';
import { resolveEffectiveBackendBaseUrl } from '../utils/backend-env-resolve.util';
import { ASKNORA_SECRETS_YAML_KEY, ASKNORA_VAULT_DEK_KEY } from './secrets-yaml-vault.keys';
import {
  decryptWithKey,
  encryptWithKey,
  getOrCreateDataEncryptionKey,
  importDekFromBase64,
} from '../utils/local-vault-crypto';

export { ASKNORA_SECRETS_YAML_KEY, ASKNORA_VAULT_DEK_KEY } from './secrets-yaml-vault.keys';

export interface YamlEnvOverrides {
  backendBaseUrl?: string;
  preferTokenBackend?: boolean;
  /**
   * Optional provider keys parsed from YAML (e.g. OPENAI_API_KEY).
   * Non-empty values merge over persisted API keys on bootstrap.
   */
  apiKeys?: Partial<Record<ApiProvider, string>>;
}

/**
 * Optional local YAML overrides for backend URL / flags. Stored encrypted by default (AES-GCM).
 */
@Injectable({ providedIn: 'root' })
export class SecretsYamlVaultService {
  /** Decrypted YAML text for editing; empty string if none. */
  readonly plaintext = signal<string>('');

  private hydrated = false;

  private readonly baseEnv = inject<AppEnvironment>(APP_ENVIRONMENT);

  constructor(
    private storage: StorageService,
    private state: StateService,
  ) {}

  /** Call from APP_INITIALIZER before API traffic. */
  async hydrateFromStorage(): Promise<void> {
    const raw = this.storage.getStringWithFallback(ASKNORA_SECRETS_YAML_KEY);
    if (raw == null || raw === '') {
      this.plaintext.set('');
      this.hydrated = true;
      return;
    }
    try {
      if (raw.startsWith('v1:')) {
        const dekB64 = this.storage.getStringWithFallback(ASKNORA_VAULT_DEK_KEY);
        if (!dekB64) {
          this.plaintext.set('');
        } else {
          const key = await importDekFromBase64(dekB64);
          const dec = await decryptWithKey(key, raw);
          this.plaintext.set(dec);
        }
      } else {
        // Legacy plaintext — migrate to encrypted on next save
        this.plaintext.set(raw);
      }
    } catch {
      this.plaintext.set('');
    }
    this.hydrated = true;
  }

  /** Sync overrides for RuntimeEnvironmentService (after hydrate). */
  getYamlOverrides(): YamlEnvOverrides {
    if (!this.hydrated) {
      return {};
    }
    return parseSimpleYaml(this.plaintext());
  }

  /** Parse provider keys from arbitrary YAML text (e.g. unsaved API modal textarea). */
  parseYamlApiKeys(yaml: string): Partial<Record<ApiProvider, string>> {
    return parseSimpleYaml(yaml).apiKeys ?? {};
  }

  /**
   * Save YAML; encrypts by default (`encrypt = true`).
   * Plaintext storage only when encrypt is false (advanced / migration).
   */
  async setPlaintextYaml(yaml: string, encrypt = true): Promise<void> {
    const trimmed = yaml.trim();
    if (trimmed === '') {
      this.storage.del(ASKNORA_SECRETS_YAML_KEY);
      this.plaintext.set('');
      return;
    }
    if (encrypt) {
      await this.ensureDataKeyInitialized();
      const dekB64 = this.storage.getStringWithFallback(ASKNORA_VAULT_DEK_KEY);
      if (!dekB64) {
        throw new Error('Vault DEK unavailable');
      }
      const key = await importDekFromBase64(dekB64);
      const enc = await encryptWithKey(key, yaml);
      this.storage.setStringWithFallback(ASKNORA_SECRETS_YAML_KEY, enc);
    } else {
      this.storage.setStringWithFallback(ASKNORA_SECRETS_YAML_KEY, yaml);
    }
    this.plaintext.set(yaml);
    this.applyYamlApiKeysToState();
  }

  /** Merge non-empty provider keys from current YAML into StateService (e.g. after Save). */
  applyYamlApiKeysToState(): void {
    const yk = parseSimpleYaml(this.plaintext()).apiKeys;
    if (!yk || !Object.keys(yk).length) {
      return;
    }
    const merged = { ...this.state.api.keys };
    for (const p of ['anthropic', 'openai', 'hf'] as const) {
      const v = yk[p];
      if (v && v.trim()) {
        merged[p] = v.trim();
      }
    }
    this.state.patchApi({ keys: merged });
    const o = this.getYamlOverrides();
    const origin = resolveEffectiveBackendBaseUrl(this.baseEnv, o);
    this.state.alignActiveProviderToConfiguredKeys(!!origin);
  }

  clearVault(): void {
    this.storage.del(ASKNORA_SECRETS_YAML_KEY);
    this.storage.del(ASKNORA_VAULT_DEK_KEY);
    this.plaintext.set('');
  }

  /** Must run once before first encrypt (e.g. from hydrate or modal open). */
  async ensureDataKeyInitialized(): Promise<void> {
    let dek = this.storage.getStringWithFallback(ASKNORA_VAULT_DEK_KEY);
    if (dek) {
      return;
    }
    const { rawB64 } = await getOrCreateDataEncryptionKey();
    this.storage.setStringWithFallback(ASKNORA_VAULT_DEK_KEY, rawB64);
  }
}

function parseSimpleYaml(text: string): YamlEnvOverrides {
  const out: YamlEnvOverrides = {};
  const apiKeys: Partial<Record<ApiProvider, string>> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) {
      continue;
    }
    const m = t.match(/^([a-zA-Z0-9_]+)\s*:\s*(.*)$/);
    if (!m) {
      continue;
    }
    const k = m[1];
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k === 'backendBaseUrl') {
      out.backendBaseUrl = v;
    }
    if (k === 'preferTokenBackend') {
      out.preferTokenBackend = v === 'true' || v === 'yes' || v === '1';
    }
    if (k === 'ANTHROPIC_API_KEY' && v) {
      apiKeys.anthropic = v;
    }
    if (k === 'OPENAI_API_KEY' && v) {
      apiKeys.openai = v;
    }
    if ((k === 'HUGGINGFACE_API_KEY' || k === 'HUGGINGFACE_API_TOKEN') && v) {
      apiKeys.hf = v;
    }
  }
  if (Object.keys(apiKeys).length > 0) {
    out.apiKeys = apiKeys;
  }
  return out;
}
