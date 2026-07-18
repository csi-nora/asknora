import { Injectable, signal } from '@angular/core';
import { TextChunk } from '../models';

/**
 * KbStorageService — tiered persistence for the heavy Knowledge-Base payload
 * (RAG chunks + dense vectors + optional doc content).
 *
 * Why this exists
 * ---------------
 * The KB vectors alone are ~0.5 MB per ingested document. Browser `localStorage`
 * is capped at ~5 MB per origin, so a real KB quickly exceeds it and `setItem`
 * throws `QuotaExceededError`. Previously that error was swallowed, so docs and
 * vectors silently failed to save and the KB looked "empty" after a reload.
 *
 * Strategy (automatic storage tiering)
 * ------------------------------------
 *  - Fast path (tier "ls"): keep the payload in localStorage while total usage
 *    stays below 80 % of the ~5 MB budget.
 *  - Overflow (tier "idb"): once usage crosses 80 % — OR a QuotaExceededError is
 *    hit — migrate the whole payload into IndexedDB (db `csinora-kb`, stores
 *    `chunks` / `vectors` / `docs`), request `navigator.storage.persist()`, and
 *    keep writing there (sticky, to avoid thrashing). A best-effort OPFS
 *    "temp-storage" folder mirror is also written when available.
 *  - Vectors are Int8-quantized in BOTH tiers (embeddings are L2-normalised, so
 *    values live in [-1, 1]) which shrinks them ~30× and keeps the footprint
 *    small regardless of tier.
 *  - An in-memory Map mirror (owned by RagService) is the source of truth for
 *    fast retrieval; this service only persists/loads.
 */

const DB_NAME   = 'csinora-kb';
const DB_VER    = 1;
const STORES    = ['chunks', 'vectors', 'docs'] as const;
const PAYLOAD   = 'payload';

const LS_CHUNKS  = 'csinora_chunks';
const LS_VECTORS = 'csinora_vectors';
const LS_TIER    = 'csinora_kb_tier';   // 'ls' | 'idb' (sticky)

const BUDGET     = 5 * 1024 * 1024;     // ~5 MB localStorage budget
const THRESHOLD  = 0.80;                 // migrate to overflow at 80 %

export type KbTier = 'ls' | 'idb';
/** Vectors serialised for storage: [chunkId, base64(Int8)] pairs. */
type QuantVec = [string, string];

@Injectable({ providedIn: 'root' })
export class KbStorageService {
  /** True once the heavy payload lives in IndexedDB/OPFS instead of localStorage. */
  overflow  = signal<boolean>(false);
  tier      = signal<KbTier>('ls');
  persisted = signal<boolean>(false);

  private _db: IDBDatabase | null = null;
  private _ready: Promise<void> | null = null;
  private _opfsTried = false;

  /** Idempotent init: read sticky tier, open IDB if needed, request persistence. */
  init(): Promise<void> {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      const sticky = (this._lsGet(LS_TIER) as KbTier) || 'ls';
      this.tier.set(sticky);
      this.overflow.set(sticky === 'idb');
      if (sticky === 'idb') { await this._openDb(); await this._requestPersist(); }
    })();
    return this._ready;
  }

  // ── Public save/load API ────────────────────────────────────────────────
  async saveChunks(chunks: TextChunk[]): Promise<void> {
    await this._ensureTierFor(this._approxBytes(chunks));
    if (this.tier() === 'idb') { await this._idbPut('chunks', chunks); return; }
    this._lsSetOrOverflow(LS_CHUNKS, JSON.stringify(chunks), () => this._idbPut('chunks', chunks));
  }

  async saveVectors(entries: [string, number[]][]): Promise<void> {
    const q: QuantVec[] = entries.map(([id, v]) => [id, quantToB64(v)]);
    await this._ensureTierFor(q.reduce((n, [, b]) => n + b.length, 0) * 2);
    if (this.tier() === 'idb') { await this._idbPut('vectors', q); this._writeOpfsMirror(q); return; }
    this._lsSetOrOverflow(LS_VECTORS, JSON.stringify(q), () => this._idbPut('vectors', q));
  }

  /** Best-effort offload of doc content (id → content) when in overflow tier. */
  async saveDocContent(map: Record<string, string>): Promise<void> {
    if (this.tier() !== 'idb') return;
    await this._idbPut('docs', map);
  }

  async loadChunks(): Promise<TextChunk[]> {
    await this.init();
    if (this.tier() === 'idb') return (await this._idbGet<TextChunk[]>('chunks')) || [];
    const raw = this._lsGet(LS_CHUNKS);
    return raw ? JSON.parse(raw) as TextChunk[] : [];
  }

  async loadVectors(): Promise<[string, number[]][]> {
    await this.init();
    let stored: any = null;
    if (this.tier() === 'idb') stored = await this._idbGet<any>('vectors');
    else { const raw = this._lsGet(LS_VECTORS); stored = raw ? JSON.parse(raw) : null; }
    if (!stored) return [];
    // Accept both quantised ([id, b64string]) and legacy full-float ([id, number[]]).
    return (stored as any[]).map(([id, v]) =>
      typeof v === 'string' ? [id, deQuantB64(v)] : [id, v as number[]]);
  }

  async loadDocContent(): Promise<Record<string, string>> {
    await this.init();
    if (this.tier() !== 'idb') return {};
    return (await this._idbGet<Record<string, string>>('docs')) || {};
  }

  async clearAll(): Promise<void> {
    try { localStorage.removeItem(LS_CHUNKS); localStorage.removeItem(LS_VECTORS); } catch { }
    if (this._db) for (const s of STORES) await this._idbClear(s).catch(() => {});
  }

  // ── Tiering logic ───────────────────────────────────────────────────────
  /** Approximate current localStorage usage in bytes (UTF-16 → 2 bytes/char). */
  lsUsage(): number {
    let total = 0;
    try { for (const k of Object.keys(localStorage)) total += (localStorage.getItem(k)?.length || 0) * 2; } catch { }
    return total;
  }
  usagePct(): number { return Math.min((this.lsUsage() / BUDGET) * 100, 100); }

  /** If adding `incomingBytes` would cross 80 %, migrate the payload to IDB. */
  private async _ensureTierFor(incomingBytes: number): Promise<void> {
    await this.init();
    if (this.tier() === 'idb') return;
    if (this.lsUsage() + incomingBytes > BUDGET * THRESHOLD) await this._migrateToIdb();
  }

  /** Move existing LS payload into IndexedDB and switch to the overflow tier. */
  private async _migrateToIdb(): Promise<void> {
    await this._openDb();
    await this._requestPersist();
    try {
      const rawChunks = this._lsGet(LS_CHUNKS);
      if (rawChunks) await this._idbPut('chunks', JSON.parse(rawChunks));
      const rawVecs = this._lsGet(LS_VECTORS);
      if (rawVecs) await this._idbPut('vectors', JSON.parse(rawVecs)); // already quantised
    } catch (e) { console.warn('[KbStore] migrate copy failed', e); }
    try { localStorage.removeItem(LS_CHUNKS); localStorage.removeItem(LS_VECTORS); } catch { }
    this._lsSet(LS_TIER, 'idb');
    this.tier.set('idb');
    this.overflow.set(true);
    console.info('[KbStore] Overflow engaged → KB migrated to IndexedDB (csinora-kb).');
  }

  /** Write to localStorage; on QuotaExceededError, migrate + persist via `fallback`. */
  private _lsSetOrOverflow(key: string, value: string, fallback: () => Promise<void>): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (isQuota(e)) {
        console.warn(`[KbStore] QuotaExceededError on ${key} → engaging IndexedDB overflow.`);
        // Fire-and-forget migration + write; retrieval keeps working from the Map mirror.
        this._migrateToIdb().then(fallback).catch(err => console.error('[KbStore] overflow write failed', err));
      } else {
        console.error('[KbStore] localStorage write failed', e);
      }
    }
  }

  // ── IndexedDB primitives ────────────────────────────────────────────────
  private _openDb(): Promise<void> {
    if (this._db) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
      req.onsuccess = () => { this._db = req.result; resolve(); };
      req.onerror   = () => reject(req.error);
    });
  }
  private _idbPut(store: string, value: any): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._db) { reject(new Error('DB not open')); return; }
      const tx = this._db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, PAYLOAD);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }
  private _idbGet<T>(store: string): Promise<T | null> {
    return new Promise((resolve, reject) => {
      if (!this._db) { resolve(null); return; }
      const tx = this._db.transaction(store, 'readonly');
      const r  = tx.objectStore(store).get(PAYLOAD);
      r.onsuccess = () => resolve((r.result ?? null) as T | null);
      r.onerror   = () => reject(r.error);
    });
  }
  private _idbClear(store: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this._db) { resolve(); return; }
      const tx = this._db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }

  private async _requestPersist(): Promise<void> {
    try {
      if (navigator.storage?.persist) {
        const already = await navigator.storage.persisted?.();
        this.persisted.set(already || await navigator.storage.persist());
      }
    } catch { /* best-effort */ }
  }

  /** Best-effort OPFS "temp-storage" mirror of the vector blob (non-critical). */
  private async _writeOpfsMirror(q: QuantVec[]): Promise<void> {
    if (this._opfsTried && !(navigator.storage as any)?.getDirectory) return;
    this._opfsTried = true;
    try {
      const root = await (navigator.storage as any)?.getDirectory?.();
      if (!root) return;
      const dir  = await root.getDirectoryHandle('temp-storage', { create: true });
      const fh   = await dir.getFileHandle('vectors.json', { create: true });
      const w    = await fh.createWritable();
      await w.write(JSON.stringify(q));
      await w.close();
    } catch { /* OPFS optional */ }
  }

  // ── tiny LS helpers ─────────────────────────────────────────────────────
  private _lsGet(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
  private _lsSet(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { } }
  private _approxBytes(o: any): number { try { return JSON.stringify(o).length * 2; } catch { return 0; } }
}

// ── Quantisation helpers (Int8, base64) ─────────────────────────────────────
function quantToB64(vec: number[]): string {
  const i8 = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    const q = Math.round(vec[i] * 127);
    i8[i] = q > 127 ? 127 : q < -128 ? -128 : q;
  }
  const bytes = new Uint8Array(i8.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function deQuantB64(s: string): number[] {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i8 = new Int8Array(bytes.buffer);
  const out = new Array(i8.length);
  for (let i = 0; i < i8.length; i++) out[i] = i8[i] / 127;
  return out;
}
function isQuota(e: any): boolean {
  return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}
