import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  ApiConfig, AuditEntry, ChatMessage, KbDocument,
  NamedSession, RagConfig, Sensitivity, StorageStats, UserRole
} from '../models';

const LS = {
  SESSION:  'csinora_session',
  DOCS:     'csinora_docs',
  AUDIT:    'csinora_audit',
  API_CFG:  'csinora_api_cfg',
  API_KEYS: 'csinora_api_keys',
  NAMED:    'csinora_named',
  PREFS:    'csinora_prefs',
};

const BUDGET = 5 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class StorageService {
  stats$        = new BehaviorSubject<StorageStats>(this._empty());
  rememberKeys$ = new BehaviorSubject<boolean>(false);

  set<T>(key: string, v: T): void {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { console.warn('LS write failed', e); }
  }
  get<T>(key: string, fb: T): T {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fb; } catch { return fb; }
  }
  del(key: string) { try { localStorage.removeItem(key); } catch { } }
  bytes(key: string) { try { return (localStorage.getItem(key)?.length || 0) * 2; } catch { return 0; } }

  loadPrefs() {
    const p = this.get<any>(LS.PREFS, {});
    this.rememberKeys$.next(p.rememberKeys ?? false);
  }
  setRememberKeys(v: boolean) {
    this.rememberKeys$.next(v);
    this.set(LS.PREFS, { rememberKeys: v });
    if (!v) this.del(LS.API_KEYS);
  }

  persist(data: {
    sector: string | null; role: UserRole; sensitivity: Sensitivity;
    useRag: boolean; ragConfig: RagConfig; msgCount: number;
    messages: ChatMessage[]; docs: KbDocument[];
    audits: AuditEntry[]; api: ApiConfig;
  }) {
    this.set(LS.SESSION, {
      sector: data.sector, role: data.role, sensitivity: data.sensitivity,
      useRag: data.useRag, ragConfig: data.ragConfig, msgCount: data.msgCount,
      messages: data.messages, savedAt: new Date().toISOString()
    });
    this.set(LS.DOCS,    data.docs);
    this.set(LS.AUDIT,   data.audits.slice(0, 100));
    this.set(LS.API_CFG, {
      provider: data.api.provider,
      models: data.api.models,
      maxTokens: data.api.maxTokens,
      baseUrls: data.api.baseUrls,
      accelDevice: data.api.accelDevice,
    });
    if (this.rememberKeys$.value) this.set(LS.API_KEYS, data.api.keys);
    this.refresh();
  }

  loadSession()  { return this.get<any>(LS.SESSION, null); }
  loadDocs()     { return this.get<KbDocument[]>(LS.DOCS, []); }
  loadAudit()    { return this.get<AuditEntry[]>(LS.AUDIT, []); }
  loadApiCfg()   { return this.get<Partial<ApiConfig>>(LS.API_CFG, {}); }
  loadApiKeys()  { return this.get<Record<string, string>>(LS.API_KEYS, {}); }

  getSessions()  { return this.get<NamedSession[]>(LS.NAMED, []); }
  saveSession(s: Omit<NamedSession, 'id' | 'savedAt'>) {
    const all = this.getSessions();
    all.unshift({ ...s, id: 'ns-' + Date.now(), savedAt: new Date().toISOString() });
    this.set(LS.NAMED, all.slice(0, 10));
    this.refresh();
  }
  deleteSession(id: string) {
    this.set(LS.NAMED, this.getSessions().filter(s => s.id !== id));
    this.refresh();
  }

  clearPartial(type: 'messages' | 'docs' | 'audit' | 'named' | 'vectors' | 'all') {
    if (type === 'messages' || type === 'all') this.del(LS.SESSION);
    if (type === 'docs'     || type === 'all') this.del(LS.DOCS);
    if (type === 'audit'    || type === 'all') this.del(LS.AUDIT);
    if (type === 'named'    || type === 'all') this.del(LS.NAMED);
    if (type === 'vectors'  || type === 'all') {
      this.del('csinora_chunks'); this.del('csinora_vectors');
    }
    if (type === 'all') {
      this.del(LS.API_CFG); this.del(LS.API_KEYS); this.del(LS.PREFS);
    }
    this.refresh();
  }

  refresh() {
    const msgSize   = this.bytes(LS.SESSION);
    const docSize   = this.bytes(LS.DOCS);
    const auditSize = this.bytes(LS.AUDIT);
    const nsSize    = this.bytes(LS.NAMED);
    const vecSize   = this.bytes('csinora_chunks') + this.bytes('csinora_vectors');
    const total     = msgSize + docSize + auditSize + nsSize + vecSize
                    + this.bytes(LS.API_CFG) + this.bytes(LS.API_KEYS);
    const sess      = this.loadSession();
    this.stats$.next({
      total, msgSize, docSize, auditSize, nsSize, vecSize,
      pct: Math.min((total / BUDGET) * 100, 100),
      lastSaved: sess?.savedAt || null,
    });
  }

  fmt(b: number): string {
    if (b < 1024) return b + ' B';
    if (b < 1_048_576) return Math.round(b / 1024) + ' KB';
    return (b / 1_048_576).toFixed(1) + ' MB';
  }

  private _empty(): StorageStats {
    return { total: 0, msgSize: 0, docSize: 0, auditSize: 0, nsSize: 0, vecSize: 0, pct: 0, lastSaved: null };
  }
}
