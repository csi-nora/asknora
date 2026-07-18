import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { StateService }   from '../../../services/state.service';
import { StorageService } from '../../../services/storage.service';
import { ApiService, PROV_LABEL } from '../../../services/api.service';
import { AuditService }   from '../../../services/audit.service';
import { AccelDevice, ApiProvider } from '../../../models';
import { environment } from '../../../../environments/environment';

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
  ollama: [
    {val:'llama3.2:3b',lbl:'llama3.2:3b (recommended)'},
    {val:'llama3.2:1b',lbl:'llama3.2:1b (fast)'},
    {val:'llama3.1:8b',lbl:'llama3.1:8b'},
    {val:'mistral:7b',lbl:'mistral:7b'},
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

      <div class="fr" *ngIf="p.k === 'ollama'">
        <label class="fl">Sandbox Base URL</label>
        <input class="fi" [(ngModel)]="baseUrls.ollama"
          placeholder="/ollama/v1 (dev proxy) or http://localhost:11434/v1">
        <div style="font-size:11px;opacity:.7;margin-top:4px">
          Dev uses Angular proxy → Ollama. Dashboard:
          <a [href]="streamlitUrl" target="_blank" rel="noopener">{{ streamlitUrl }}</a>
        </div>
      </div>

      <div class="fr" *ngIf="p.k === 'openai'">
        <label class="fl">API Base URL (optional)</label>
        <input class="fi" [(ngModel)]="baseUrls.openai" placeholder="https://api.openai.com/v1">
      </div>

      <div class="fr" *ngIf="p.k !== 'ollama'">
        <label class="fl">API Key</label>
        <input class="fi" type="password" [(ngModel)]="keys[p.k]" [placeholder]="p.keyHint">
      </div>
      <div class="fr" *ngIf="p.k === 'ollama'">
        <label class="fl">API Key (optional)</label>
        <input class="fi" type="password" [(ngModel)]="keys.ollama" placeholder="ollama (default)">
      </div>

      <div class="fr"><label class="fl">Model</label>
        <div class="model-chips">
          <button *ngFor="let m of MODELS[p.k]" class="model-chip" [class.sel]="models[p.k]===m.val"
            (click)="selModel(p.k, m.val)">{{ m.lbl }}</button>
        </div>
        <input *ngIf="(p.k==='hf' || p.k==='ollama') && models[p.k]==='custom'" class="fi"
          [(ngModel)]="customModel" placeholder="model name" style="margin-top:6px">
      </div>

      <div class="fr" *ngIf="p.k === 'ollama'">
        <label class="fl">Compute scale</label>
        <div class="model-chips">
          <button *ngFor="let a of accelOptions" class="model-chip" [class.sel]="accelDevice===a.val"
            (click)="accelDevice=a.val">{{ a.lbl }}</button>
        </div>
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
  streamlitUrl = environment.streamlitUrl;
  accelOptions: {val: AccelDevice; lbl: string}[] = [
    { val: 'auto', lbl: 'Auto' },
    { val: 'cpu',  lbl: 'CPU' },
    { val: 'gpu',  lbl: 'GPU' },
    { val: 'npu',  lbl: 'NPU' },
  ];
  provs = [
    {k:'ollama'    as ApiProvider,icon:'🔵',label:'Ollama',    keyHint:'ollama'},
    {k:'anthropic' as ApiProvider,icon:'🟠',label:'Anthropic', keyHint:'sk-ant-…'},
    {k:'openai'    as ApiProvider,icon:'🟢',label:'OpenAI',    keyHint:'sk-…'},
    {k:'hf'        as ApiProvider,icon:'🟡',label:'HuggingFace',keyHint:'hf_…'},
  ];
  tab     = signal<ApiProvider>('ollama');
  testing = signal(false);
  testMsg = signal('');
  testOk  = signal(false);
  customModel = '';
  accelDevice: AccelDevice = 'auto';

  keys:   Record<ApiProvider,string>  = { anthropic:'', openai:'', hf:'', ollama:'ollama' };
  models: Record<ApiProvider,string>  = {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    hf: 'mistralai/Mistral-7B-Instruct-v0.3',
    ollama: environment.defaultOllamaModel,
  };
  maxTok: Record<ApiProvider,number>  = { anthropic:1200, openai:1200, hf:900, ollama:512 };
  baseUrls: Partial<Record<ApiProvider,string>> = {
    ollama: environment.ollamaBaseUrl,
    openai: 'https://api.openai.com/v1',
  };

  constructor(
    public  st: StateService,
    private ss: StorageService,
    private apiSvc: ApiService,
    private au: AuditService,
  ) {
    this.keys   = { ...st.api.keys };
    this.models = { ...st.api.models };
    this.maxTok = { ...st.api.maxTokens };
    this.baseUrls = { ...st.api.baseUrls };
    this.accelDevice = st.api.accelDevice || 'auto';
    this.tab.set(st.api.provider);
  }

  get rememberKeys() { return this.ss.rememberKeys$.value; }
  set rememberKeys(v: boolean) { this.ss.setRememberKeys(v); }

  selModel(p: ApiProvider, v: string) { this.models[p] = v; }

  save() {
    const p = this.tab();
    let model = this.models[p];
    if ((p === 'hf' || p === 'ollama') && model === 'custom') model = this.customModel || model;
    this.st.patchApi({
      provider: p,
      models: { ...this.models, [p]: model },
      keys: { ...this.keys },
      maxTokens: { ...this.maxTok },
      baseUrls: { ...this.baseUrls },
      accelDevice: this.accelDevice,
    });
    this.au.log('Provider Changed', `${PROV_LABEL[p]} · ${this.apiSvc.shortModel(p)} · ${this.accelDevice}`, 'internal');
    this.close();
  }

  async test() {
    this.testing.set(true);
    this.testMsg.set('🔌 Testing…');
    const p = this.tab();
    const savedKeys = { ...this.st.api.keys };
    const savedUrls = { ...this.st.api.baseUrls };
    const savedProv = this.st.api.provider;
    this.st.patchApi({
      provider: p,
      keys: { ...this.st.api.keys, ...this.keys },
      baseUrls: { ...this.st.api.baseUrls, ...this.baseUrls },
      models: { ...this.st.api.models, ...this.models },
    });
    const ok = await this.apiSvc.checkHealth(true);
    this.testOk.set(ok);
    this.testMsg.set(ok
      ? (p === 'ollama' ? '✅ Sandbox Ollama reachable!' : '✅ Connection successful!')
      : (p === 'ollama'
        ? '❌ Ollama offline — run: docker compose up -d in ai-ecosystem-sandbox'
        : '❌ Connection failed — check your API key.'));
    this.st.patchApi({ provider: savedProv, keys: savedKeys, baseUrls: savedUrls });
    this.testing.set(false);
  }

  close() { this.st.activeModal.set(null); }
}
