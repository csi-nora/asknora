import { Injectable, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  ApiConfig, ApiProvider, AuditEntry, ChatMessage, HybridMode,
  KbDocument, RagConfig, Sensitivity, UserRole
} from '../models';

export const DEFAULT_RAG_CONFIG: RagConfig = {
  mode: 'hybrid', topK: 5, chunkSize: 400, overlap: 60, minScore: 0.05
};

@Injectable({ providedIn: 'root' })
export class StateService {
  // Signals
  sector      = signal<string | null>(null);
  role        = signal<UserRole>('engineer');
  sensitivity = signal<Sensitivity>('internal');
  useRag      = signal<boolean>(true);
  isLoading   = signal<boolean>(false);
  msgCount    = signal<number>(0);
  hybridMode  = signal<HybridMode>('checking');
  activeModal = signal<'api' | 'portability' | 'rag-config' | null>(null);
  ragConfig   = signal<RagConfig>({ ...DEFAULT_RAG_CONFIG });

  // Collections
  messages$     = new BehaviorSubject<ChatMessage[]>([]);
  docs$         = new BehaviorSubject<KbDocument[]>([]);
  auditEntries$ = new BehaviorSubject<AuditEntry[]>([]);

  // API config (plain object, not signal)
  api: ApiConfig = {
    provider:  'anthropic',
    models:    { anthropic: 'claude-sonnet-4-20250514', openai: 'gpt-4o', hf: 'mistralai/Mistral-7B-Instruct-v0.3' },
    keys:      { anthropic: '', openai: '', hf: '' },
    maxTokens: { anthropic: 1200, openai: 1200, hf: 900 }
  };

  get messages()     { return this.messages$.value; }
  get docs()         { return this.docs$.value; }
  get auditEntries() { return this.auditEntries$.value; }

  addMessage(m: ChatMessage) { this.messages$.next([...this.messages, m]); this.msgCount.update(n => n + 1); }
  clearMessages()             { this.messages$.next([]); this.msgCount.set(0); }
  setMessages(ms: ChatMessage[]) { this.messages$.next(ms); this.msgCount.set(ms.length); }

  addDoc(d: KbDocument)         { this.docs$.next([...this.docs, d]); }
  removeDoc(id: string)         { this.docs$.next(this.docs.filter(d => d.id !== id)); }
  updateDoc(d: KbDocument)      { this.docs$.next(this.docs.map(x => x.id === d.id ? d : x)); }
  setDocs(ds: KbDocument[])     { this.docs$.next(ds); }

  addAudit(e: AuditEntry)       { this.auditEntries$.next([e, ...this.auditEntries]); }
  setAudits(es: AuditEntry[])   { this.auditEntries$.next(es); }

  patchApi(cfg: Partial<ApiConfig>) {
    this.api = {
      ...this.api, ...cfg,
      models:    { ...this.api.models,    ...(cfg.models    || {}) },
      keys:      { ...this.api.keys,      ...(cfg.keys      || {}) },
      maxTokens: { ...this.api.maxTokens, ...(cfg.maxTokens || {}) }
    };
  }

  /**
   * Browser-direct mode only: if the active provider has no API key but another provider does,
   * switch to the first provider that has a key (OpenAI → Anthropic → HF).
   * Skipped when using the CSI Nora gateway (keys come from the server).
   */
  alignActiveProviderToConfiguredKeys(useGateway: boolean): void {
    if (useGateway) {
      return;
    }
    const k = this.api.keys;
    const has = (p: ApiProvider) => !!(k[p]?.trim());
    const cur = this.api.provider;
    if (has(cur)) {
      return;
    }
    if (has('openai')) {
      this.patchApi({ provider: 'openai' });
    } else if (has('anthropic')) {
      this.patchApi({ provider: 'anthropic' });
    } else if (has('hf')) {
      this.patchApi({ provider: 'hf' });
    }
  }

  readonly ROLE_ACL: Record<UserRole, Sensitivity[]> = {
    engineer:  ['public', 'internal'],
    support:   ['public', 'internal'],
    sales:     ['public', 'internal', 'confidential'],
    manager:   ['public', 'internal', 'confidential'],
    executive: ['public', 'internal', 'confidential']
  };

  canAccess(s: Sensitivity) { return this.ROLE_ACL[this.role()].includes(s); }
}
