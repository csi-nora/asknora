import { Injectable, signal } from '@angular/core';
import { KbDocument, RagConfig, RetrievedChunk, Sensitivity, TextChunk } from '../models';
import { environment } from '../../environments/environment';

/**
 * KbBackendService — talks to the server-side, disk-backed Knowledge Base API
 * exposed by the Nora bridge (FastAPI) under the reverse-proxy path `/sandbox/kb`.
 *
 * When the bridge is reachable (full Docker stack), the KB lives on the HOST disk
 * via Qdrant (dense vectors) + Postgres (registry + chunk text + full-text sparse):
 * effectively unlimited, shared across browsers/devices, and surviving both browser
 * clearing and container/host restarts.
 *
 * When the bridge is NOT reachable (e.g. the static GitHub Pages demo), the app
 * falls back to the browser-side store (RagService + KbStorageService). This
 * service only owns the *server* path + availability detection; RagService decides
 * which path to use based on `mode()`.
 */

export type KbMode = 'server' | 'browser' | 'unknown';

interface ServerDoc {
  id: string; name: string; type: string; size: number;
  sensitivity: Sensitivity; chunkCount: number; indexed: boolean; uploadedAt?: string;
}
interface ServerRetrieved {
  chunkId: string; docId: string; docName: string; content: string; sensitivity: Sensitivity;
  denseScore: number; sparseScore: number; hybridScore: number; rank: number;
}

@Injectable({ providedIn: 'root' })
export class KbBackendService {
  /** Active KB backing. 'server' = disk-backed bridge; 'browser' = offline fallback. */
  mode = signal<KbMode>('unknown');
  /** Server-reported counts (for the sidebar indicator). */
  stats = signal<{ docCount: number; chunkCount: number; vectorCount: number; collection: string }>(
    { docCount: 0, chunkCount: 0, vectorCount: 0, collection: '' });

  private base = environment.sandboxBridgeUrl.replace(/\/$/, '') + '/kb';

  get isServer() { return this.mode() === 'server'; }

  /** Probe the bridge KB health. Marks mode 'server' only if BOTH stores are up. */
  async probe(): Promise<boolean> {
    try {
      const r = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) { this.mode.set('browser'); return false; }
      const h = await r.json();
      const ok = !!h.postgres && !!h.qdrant;
      this.mode.set(ok ? 'server' : 'browser');
      if (ok) this.stats.set({ docCount: h.docCount || 0, chunkCount: h.chunkCount || 0, vectorCount: h.vectorCount || 0, collection: h.collectionName || '' });
      return ok;
    } catch {
      this.mode.set('browser');
      return false;
    }
  }

  async refreshStats(): Promise<void> {
    try {
      const r = await fetch(`${this.base}/health`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return;
      const h = await r.json();
      this.stats.set({ docCount: h.docCount || 0, chunkCount: h.chunkCount || 0, vectorCount: h.vectorCount || 0, collection: h.collectionName || '' });
    } catch { /* leave last-known stats */ }
  }

  async listDocs(): Promise<KbDocument[]> {
    const r = await fetch(`${this.base}/documents`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`KB list failed: ${r.status}`);
    const docs: ServerDoc[] = await r.json();
    return docs.map(d => ({
      id: d.id, name: d.name, type: d.type, size: d.size, content: '',
      sensitivity: d.sensitivity, uploadedAt: d.uploadedAt || new Date().toISOString(),
      chunkCount: d.chunkCount, indexed: d.indexed,
    }));
  }

  /** Ingest a doc + its chunks (with client-computed dense vectors) to the server. */
  async ingestDoc(
    doc: KbDocument,
    chunks: { chunk: TextChunk; vector: number[] | null }[],
  ): Promise<{ chunkCount: number; indexed: boolean }> {
    const body = {
      id: doc.id, name: doc.name, type: doc.type, size: doc.size,
      sensitivity: doc.sensitivity, content: doc.content, uploadedAt: doc.uploadedAt,
      chunks: chunks.map(({ chunk, vector }) => ({
        id: chunk.id, docId: chunk.docId, docName: chunk.docName,
        content: chunk.content, sensitivity: chunk.sensitivity, vector,
      })),
    };
    const r = await fetch(`${this.base}/documents`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    });
    if (!r.ok) throw new Error(`KB ingest failed: ${r.status} ${await r.text().catch(() => '')}`);
    const out = await r.json();
    return { chunkCount: out.chunkCount, indexed: out.indexed };
  }

  async deleteDoc(id: string): Promise<void> {
    const r = await fetch(`${this.base}/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE', signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) throw new Error(`KB delete failed: ${r.status}`);
  }

  /** Server-side hybrid retrieval (dense + sparse + RRF), mapped to the UI shape. */
  async query(
    query: string, queryVector: number[] | null, cfg: RagConfig, sensitivities: Sensitivity[],
  ): Promise<RetrievedChunk[]> {
    const body = {
      query, queryVector, topK: cfg.topK, minScore: cfg.minScore,
      mode: cfg.mode, sensitivities,
    };
    const r = await fetch(`${this.base}/query`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(`KB query failed: ${r.status}`);
    const items: ServerRetrieved[] = await r.json();
    return items.map(it => ({
      chunk: {
        id: it.chunkId, docId: it.docId, docName: it.docName,
        content: it.content, sensitivity: it.sensitivity,
      },
      denseScore: it.denseScore, sparseScore: it.sparseScore,
      hybridScore: it.hybridScore, rank: it.rank,
    }));
  }
}
