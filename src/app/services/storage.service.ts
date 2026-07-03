import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import {
  ApiConfig, AuditEntry, ChatHistoryEntry, ChatMessage, KbDocument,
  NamedSession, RagConfig, Sensitivity, StorageStats, UserRole
} from '../models';
import { ASKNORA_SECRETS_YAML_KEY, ASKNORA_VAULT_DEK_KEY } from './secrets-yaml-vault.keys';
import { ExternalStorageService } from './external-storage.service';

const LS = {
  SESSION:  'csinora_session',
  DOCS:     'csinora_docs',
  AUDIT:    'csinora_audit',
  API_CFG:  'csinora_api_cfg',
  API_KEYS: 'csinora_api_keys',
  NAMED:    'csinora_named',
  PREFS:    'csinora_prefs',
  /** Ask Nora reference history (query + response), up to 50 turns */
  CHAT_REF: 'csinora_chat_reference_v1',
  /** Launcher: governance | ask-nora | both */
  PRODUCT_MODE: 'csinora_product_mode',
};

const MANIFEST_KEY = 'csinora_storage_manifest';

const BUDGET = 5 * 1024 * 1024;

/** Tracks which logical keys are stored in IndexedDB (localStorage held payload moved on quota). */
interface StorageManifest {
  idbKeys: string[];
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  stats$        = new BehaviorSubject<StorageStats>(this._empty());
  rememberKeys$ = new BehaviorSubject<boolean>(false);

  /** Mirrors last successful read/write so sync `get` works after IDB hydration or immediate `set`. */
  private readonly stringCache = new Map<string, string>();

  private idbPromise: Promise<IDBDatabase> | null = null;

  constructor(private externalStorage: ExternalStorageService) {}

  loadPrefs() {
    const p = this.get<any>(LS.PREFS, {});
    this.rememberKeys$.next(p.rememberKeys ?? false);
  }
  setRememberKeys(v: boolean) {
    this.rememberKeys$.next(v);
    this.set(LS.PREFS, { rememberKeys: v });
    if (!v) this.del(LS.API_KEYS);
  }

  /**
   * Run from APP_INITIALIZER: load IndexedDB payloads into `stringCache` so sync `get` works for IDB-backed keys.
   */
  hydrateIndexedDbFallback(): Promise<void> {
    const m = this.readManifest();
    const tasks = m.idbKeys.map(async (key) => {
      try {
        const v = await this.idbGet(key);
        if (v != null) {
          this.stringCache.set(key, v);
        }
      } catch (e) {
        console.warn('StorageService: IDB hydrate failed for', key, e);
      }
    });
    return Promise.all(tasks).then(() => undefined);
  }

  /** Ingest payload from OPFS/external tier without re-mirroring (APP_INITIALIZER hydration). */
  ingestFromExtendedTier(key: string, raw: string): void {
    this.setStringWithFallback(key, raw, { skipMirror: true });
  }

  set<T>(key: string, v: T): void {
    this.setStringWithFallback(key, JSON.stringify(v));
  }

  get<T>(key: string, fb: T): T {
    const s = this.getStringWithFallback(key);
    if (s == null) {
      return fb;
    }
    try {
      return JSON.parse(s) as T;
    } catch {
      return fb;
    }
  }

  del(key: string): void {
    this.removeKeyEverywhere(key);
  }

  bytes(key: string): number {
    if (this.stringCache.has(key)) {
      return this.stringCache.get(key)!.length * 2;
    }
    try {
      return (localStorage.getItem(key)?.length || 0) * 2;
    } catch {
      return 0;
    }
  }

  /** Large string payloads (e.g. RAG chunks) — same LS → IDB fallback as `set`. */
  setStringWithFallback(key: string, raw: string, options?: { skipMirror?: boolean }): void {
    this.stringCache.set(key, raw);
    try {
      localStorage.setItem(key, raw);
      this.unmarkIdb(key);
      void this.idbDelete(key).catch(() => {});
    } catch (e) {
      if (!this.isQuotaExceededError(e)) {
        console.warn('StorageService: write failed', e);
        return;
      }
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      this.markIdb(key);
      void this.idbSet(key, raw).catch((err) => {
        console.warn('StorageService: IndexedDB fallback failed for', key, err);
      });
    }
    if (!options?.skipMirror) {
      this.externalStorage.mirrorKey(key, raw);
    }
  }

  getStringWithFallback(key: string): string | null {
    if (this.stringCache.has(key)) {
      return this.stringCache.get(key)!;
    }
    try {
      const fromLs = localStorage.getItem(key);
      if (fromLs != null) {
        this.stringCache.set(key, fromLs);
        return fromLs;
      }
    } catch {
      return null;
    }
    if (this.readManifest().idbKeys.includes(key)) {
      return this.stringCache.get(key) ?? null;
    }
    return null;
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
    this.set(LS.API_CFG, { provider: data.api.provider, models: data.api.models, maxTokens: data.api.maxTokens });
    if (this.rememberKeys$.value) this.set(LS.API_KEYS, data.api.keys);
    this.refresh();
  }

  loadSession()  { return this.get<any>(LS.SESSION, null); }
  loadDocs()     { return this.get<KbDocument[]>(LS.DOCS, []); }
  loadAudit()    { return this.get<AuditEntry[]>(LS.AUDIT, []); }
  loadApiCfg()   { return this.get<Partial<ApiConfig>>(LS.API_CFG, {}); }
  loadApiKeys()  { return this.get<Record<string, string>>(LS.API_KEYS, {}); }

  loadChatReference(): ChatHistoryEntry[] {
    return this.get<ChatHistoryEntry[]>(LS.CHAT_REF, []);
  }

  saveChatReference(entries: ChatHistoryEntry[]): void {
    this.set(LS.CHAT_REF, entries);
    this.refresh();
  }

  clearChatReference(): void {
    this.del(LS.CHAT_REF);
    this.refresh();
  }

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
      this.removeKeyEverywhere('csinora_chunks');
      this.removeKeyEverywhere('csinora_vectors');
    }
    if (type === 'all') {
      this.del(LS.API_CFG); this.del(LS.API_KEYS); this.del(LS.PREFS);
      this.del(LS.CHAT_REF);
      this.del(LS.PRODUCT_MODE);
      this.del(ASKNORA_SECRETS_YAML_KEY);
      this.del(ASKNORA_VAULT_DEK_KEY);
    }
    this.refresh();
  }

  refresh() {
    const msgSize   = this.bytes(LS.SESSION);
    const docSize   = this.bytes(LS.DOCS);
    const auditSize = this.bytes(LS.AUDIT);
    const nsSize    = this.bytes(LS.NAMED);
    const vecSize   = this.bytes('csinora_chunks') + this.bytes('csinora_vectors');
    const chatRefSize = this.bytes(LS.CHAT_REF);
    const total     = msgSize + docSize + auditSize + nsSize + vecSize + chatRefSize
                    + this.bytes(LS.API_CFG) + this.bytes(LS.API_KEYS);
    const sess      = this.loadSession();
    this.stats$.next({
      total, msgSize, docSize, auditSize, nsSize, vecSize, chatRefSize,
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
    return { total: 0, msgSize: 0, docSize: 0, auditSize: 0, nsSize: 0, vecSize: 0, chatRefSize: 0, pct: 0, lastSaved: null };
  }

  private readManifest(): StorageManifest {
    try {
      const raw = localStorage.getItem(MANIFEST_KEY);
      if (!raw) {
        return { idbKeys: [] };
      }
      const m = JSON.parse(raw) as { idbKeys?: string[] };
      return { idbKeys: Array.isArray(m.idbKeys) ? m.idbKeys : [] };
    } catch {
      return { idbKeys: [] };
    }
  }

  private writeManifest(m: StorageManifest): void {
    try {
      localStorage.setItem(MANIFEST_KEY, JSON.stringify(m));
    } catch (e) {
      console.warn('StorageService: manifest write failed', e);
    }
  }

  private markIdb(key: string): void {
    const m = this.readManifest();
    if (!m.idbKeys.includes(key)) {
      m.idbKeys.push(key);
      this.writeManifest(m);
    }
  }

  private unmarkIdb(key: string): void {
    const m = this.readManifest();
    const next = m.idbKeys.filter(k => k !== key);
    if (next.length !== m.idbKeys.length) {
      m.idbKeys = next;
      this.writeManifest(m);
    }
  }

  private removeKeyEverywhere(key: string): void {
    this.stringCache.delete(key);
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    void this.idbDelete(key).catch(() => {});
    this.unmarkIdb(key);
    this.externalStorage.removeMirroredKey(key);
  }

  private isQuotaExceededError(e: unknown): boolean {
    return e instanceof DOMException && (
      e.code === 22 ||
      e.code === 1014 ||
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    );
  }

  private openIdb(): Promise<IDBDatabase> {
    if (this.idbPromise) {
      return this.idbPromise;
    }
    this.idbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('csi-nora-kv', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
    return this.idbPromise;
  }

  private async idbSet(key: string, value: string): Promise<void> {
    const db = await this.openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async idbGet(key: string): Promise<string | null> {
    const db = await this.openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readonly');
      const r = tx.objectStore('kv').get(key);
      r.onsuccess = () => {
        const row = r.result as { key: string; value: string } | undefined;
        resolve(row?.value ?? null);
      };
      r.onerror = () => reject(r.error);
    });
  }

  private async idbDelete(key: string): Promise<void> {
    const db = await this.openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
