import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { StateService }   from '../../../services/state.service';
import { StorageService } from '../../../services/storage.service';
import { ApiService, PROV_LABEL } from '../../../services/api.service';
import { AuditService }   from '../../../services/audit.service';
import { RuntimeEnvironmentService } from '../../../services/runtime-environment.service';
import { SecretsYamlVaultService } from '../../../services/secrets-yaml-vault.service';
import { useBackendGateway } from '../../../utils/backend-llm-urls';
import { ApiProvider }    from '../../../models';

const MODELS: Record<ApiProvider, {val:string;lbl:string}[]> = {
  anthropic: [
    {val:'claude-sonnet-4-20250514',lbl:'claude-sonnet-4'},
    {val:'claude-opus-4-20250514',lbl:'claude-opus-4'},
    {val:'claude-haiku-4-5-20251001',lbl:'claude-haiku-4'},
  ],
  openai: [
    {val:'gpt-4o',lbl:'gpt-4o'},{val:'gpt-4o-mini',lbl:'gpt-4o-mini'},
    {val:'gpt-4-turbo',lbl:'gpt-4-turbo'},{val:'o1',lbl:'o1'},
  ],
  hf: [
    {val:'mistralai/Mistral-7B-Instruct-v0.3',lbl:'Mistral-7B'},
    {val:'meta-llama/Meta-Llama-3-8B-Instruct',lbl:'Llama-3-8B'},
    {val:'HuggingFaceH4/zephyr-7b-beta',lbl:'Zephyr-7B'},
    {val:'custom',lbl:'Custom…'},
  ],
};

@Component({
  selector: 'app-api-config-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="modal-overlay" (click)="close()">
<div class="modal" (click)="$event.stopPropagation()">
  <div class="modal-header">
    <div class="modal-title">⚙️ AI Provider Configuration</div>
    <button class="modal-close" (click)="close()">✕</button>
  </div>

  <div class="prov-tabs">
    <button class="prov-tab" *ngFor="let p of provs" [class.active]="tab()===p.k" (click)="tab.set(p.k)">
      {{ p.icon }} {{ p.label }}
    </button>
  </div>

  <ng-container *ngFor="let p of provs">
    <div *ngIf="tab()===p.k">
      <div class="modal-section-title">{{ PROV_LABEL[p.k] }}</div>
      <div class="fr"><label class="fl">API Key</label>
        <input class="fi" type="password" [(ngModel)]="keys[p.k]" [placeholder]="p.keyHint">
        <p *ngIf="gatewayMode()" style="font-size:12px;opacity:.9;margin:6px 0 0;line-height:1.45;grid-column:1/-1;">
          Using the <strong>gateway</strong> (<code>backendBaseUrl</code>): provider keys come from <code>server/.env</code> on the machine running <code>npm run gateway</code>. This field can stay empty. After editing <code>.env</code>, restart the gateway so it reloads <code>OPENAI_API_KEY</code> / etc.
        </p>
        <p *ngIf="!gatewayMode() && !keys[p.k]?.trim()" style="font-size:12px;opacity:.95;margin:6px 0 0;line-height:1.45;grid-column:1/-1;color:#e8a598;">
          No gateway: paste your API key here, or set <code>backendBaseUrl</code> (YAML below or <code>environment.ts</code>) to <code>http://127.0.0.1:3456</code> and put keys in <code>server/.env</code>.
        </p>
      </div>
      <div class="fr"><label class="fl">Model</label>
        <div class="model-chips">
          <button *ngFor="let m of MODELS[p.k]" class="model-chip" [class.sel]="models[p.k]===m.val"
            (click)="selModel(p.k, m.val)">{{ m.lbl }}</button>
        </div>
        <input *ngIf="p.k==='hf' && models.hf==='custom'" class="fi" [(ngModel)]="customHf"
          placeholder="org/model-name" style="margin-top:6px">
      </div>
      <div class="fr"><label class="fl">Max Tokens</label>
        <input class="fi" type="number" [(ngModel)]="maxTok[p.k]" min="100" max="4000"></div>
    </div>
  </ng-container>

  <div class="btn-row">
    <button class="btn-p" (click)="save()">✓ Save & Activate</button>
    <button class="btn-s" (click)="test()" [disabled]="testing()">
      {{ testing() ? '…Testing…' : '🔌 Test Connection' }}
    </button>
    <button class="btn-s" (click)="close()">Cancel</button>
  </div>

  <label class="remember-keys">
    <input type="checkbox" [(ngModel)]="rememberKeys"> Remember API keys in localStorage
  </label>

  <div class="modal-section-title" style="margin-top:14px">Local YAML (optional)</div>
  <p style="opacity:.85;font-size:12px;margin:4px 0 8px">Gateway URL and flags. Stored under <code>asknora-secrets-yaml-v1</code>; encryption is on by default.</p>
  <textarea class="fi" rows="5" [(ngModel)]="secretsYaml" placeholder="# Example:&#10;backendBaseUrl: https://api.example.com&#10;preferTokenBackend: true" style="width:100%;font-family:ui-monospace,monospace;font-size:12px"></textarea>
  <label class="remember-keys" style="margin-top:8px">
    <input type="checkbox" [(ngModel)]="encryptYamlAtRest"> Encrypt YAML at rest (recommended)
  </label>
  <div *ngIf="gatewayConfigWarning()" class="test-result test-fail" style="margin-top:8px">
    Production prefers the token backend, but <code>backendBaseUrl</code> is empty. Set it in YAML or your deployment environment.
  </div>

  <div *ngIf="testMsg()" class="test-result" [ngClass]="testOk()?'test-ok':'test-fail'" style="margin-top:8px">
    {{ testMsg() }}
  </div>
</div>
</div>
  `
})
export class ApiConfigModalComponent {
  MODELS    = MODELS;
  PROV_LABEL = PROV_LABEL;
  provs = [
    {k:'anthropic' as ApiProvider,icon:'🟠',label:'Anthropic',keyHint:'sk-ant-…'},
    {k:'openai'    as ApiProvider,icon:'🟢',label:'OpenAI',   keyHint:'sk-…'},
    {k:'hf'        as ApiProvider,icon:'🟡',label:'HuggingFace',keyHint:'hf_…'},
  ];
  tab     = signal<ApiProvider>('anthropic');
  testing = signal(false);
  testMsg = signal('');
  testOk  = signal(false);
  customHf = '';
  /** Optional local YAML; encrypted at rest when `encryptYamlAtRest` is true (default). */
  secretsYaml = '';
  encryptYamlAtRest = true;

  keys:   Record<ApiProvider,string>  = { anthropic:'', openai:'', hf:'' };
  models: Record<ApiProvider,string>  = { anthropic:'claude-sonnet-4-20250514', openai:'gpt-4o', hf:'mistralai/Mistral-7B-Instruct-v0.3' };
  maxTok: Record<ApiProvider,number>  = { anthropic:1200, openai:1200, hf:900 };

  constructor(
    public  st: StateService,
    private ss: StorageService,
    private apiSvc: ApiService,
    private au: AuditService,
    private vault: SecretsYamlVaultService,
    private runtime: RuntimeEnvironmentService,
  ) {
    this.keys   = { ...st.api.keys };
    this.models = { ...st.api.models };
    this.maxTok = { ...st.api.maxTokens };
    this.secretsYaml = this.vault.plaintext();
  }

  /** LLM traffic goes through CSI Nora gateway — browser does not send provider keys. */
  gatewayMode(): boolean {
    return useBackendGateway(this.runtime.effective());
  }

  /** Effective env prefers gateway but no base URL is configured. */
  gatewayConfigWarning(): boolean {
    const e = this.runtime.effective();
    return !!(e.preferTokenBackend && !(e.backendBaseUrl || '').trim());
  }

  get rememberKeys() { return this.ss.rememberKeys$.value; }
  set rememberKeys(v: boolean) { this.ss.setRememberKeys(v); }

  selModel(p: ApiProvider, v: string) { this.models[p] = v; }

  async save() {
    const p = this.tab();
    let model = this.models[p];
    if (p === 'hf' && model === 'custom') model = this.customHf || model;
    this.st.patchApi({
      provider: p,
      models: { ...this.models, [p]: model },
      keys: { ...this.keys },
      maxTokens: { ...this.maxTok },
    });
    try {
      await this.vault.setPlaintextYaml(this.secretsYaml, this.encryptYamlAtRest);
    } catch (e) {
      console.warn('Secrets YAML save failed', e);
      this.testMsg.set('Provider settings saved. Could not save local YAML (vault).');
      this.testOk.set(false);
      return;
    }
    this.au.log('Provider Changed', `${PROV_LABEL[p]} · ${this.apiSvc.shortModel(p)}`, 'internal');
    this.close();
  }

  async test() {
    this.testing.set(true);
    this.testMsg.set('🔌 Testing…');
    const tab = this.tab();
    const savedKey = this.st.api.keys[tab];
    const yamlKs = this.vault.parseYamlApiKeys(this.secretsYaml);
    const merged: Record<ApiProvider, string> = { ...this.st.api.keys, ...this.keys };
    for (const p of ['anthropic', 'openai', 'hf'] as ApiProvider[]) {
      const y = yamlKs[p];
      if (y?.trim()) {
        merged[p] = y.trim();
      }
    }
    this.st.patchApi({ provider: tab, keys: merged });
    const ok = await this.apiSvc.checkHealth(true);
    this.testOk.set(ok);
    const gw = useBackendGateway(this.runtime.effective());
    if (ok) {
      this.testMsg.set('✅ Connection successful!');
    } else if (gw) {
      this.testMsg.set(
        '❌ Failed — gateway mode: the browser does not send API keys. Set ANTHROPIC_API_KEY / OPENAI_API_KEY / HUGGINGFACE_API_KEY in server/.env and restart npm run gateway. To test keys from this dialog, remove backendBaseUrl from YAML (or use empty string) and try again.',
      );
    } else {
      this.testMsg.set(
        '❌ Connection failed — check the key for this tab, backendBaseUrl matches your app URL (same port), and npm run gateway + start:with-gateway when using a gateway.',
      );
    }
    if (!this.keys[tab]?.trim() && !yamlKs[tab]?.trim()) {
      this.st.patchApi({ keys: { ...this.st.api.keys, [tab]: savedKey } });
    }
    this.testing.set(false);
  }

  close() { this.st.activeModal.set(null); }
}
