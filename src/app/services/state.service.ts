import { Injectable, signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  AccelDevice, ApiConfig, AuditEntry, ChatMessage, HybridMode,
  KbDocument, RagConfig, Sensitivity, UserRole
} from '../models';
import { environment } from '../../environments/environment';

export const DEFAULT_RAG_CONFIG: RagConfig = {
  // minScore applies to the fused RRF score (~1/(k+rank)); with k=60 the top hit
  // is ≈0.033, so the old 0.05 filtered out every chunk. Keep a small noise floor.
  mode: 'hybrid', topK: 5, chunkSize: 400, overlap: 60, minScore: 0.01
};

export const DEFAULT_API_CONFIG: ApiConfig = {
  provider:  environment.defaultProvider,
  models:    {
    anthropic: 'claude-sonnet-4-20250514',
    openai:    'gpt-4o',
    hf:        'mistralai/Mistral-7B-Instruct-v0.3',
    ollama:    environment.defaultOllamaModel,
  },
  keys:      { anthropic: '', openai: '', hf: '', ollama: 'ollama' },
  maxTokens: { anthropic: 1200, openai: 1200, hf: 900, ollama: 512 },
  baseUrls:  {
    openai: 'https://api.openai.com/v1',
    ollama: environment.ollamaBaseUrl,
  },
  accelDevice: environment.defaultAccelDevice as AccelDevice,
};

@Injectable({ providedIn: 'root' })
export class StateService {
  sector      = signal<string | null>(null);
  role        = signal<UserRole>('engineer');
  sensitivity = signal<Sensitivity>('internal');
  useRag      = signal<boolean>(true);
  isLoading   = signal<boolean>(false);
  msgCount    = signal<number>(0);
  hybridMode  = signal<HybridMode>('checking');
  activeModal = signal<'api' | 'portability' | 'rag-config' | null>(null);
  ragConfig   = signal<RagConfig>({ ...DEFAULT_RAG_CONFIG });

  messages$     = new BehaviorSubject<ChatMessage[]>([]);
  docs$         = new BehaviorSubject<KbDocument[]>([]);
  auditEntries$ = new BehaviorSubject<AuditEntry[]>([]);

  api: ApiConfig = structuredClone(DEFAULT_API_CONFIG);

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
      maxTokens: { ...this.api.maxTokens, ...(cfg.maxTokens || {}) },
      baseUrls:  { ...this.api.baseUrls,  ...(cfg.baseUrls  || {}) },
    };
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
