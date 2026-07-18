import { Injectable, signal } from '@angular/core';
import { KbDocument, RagConfig, RagStats, RetrievedChunk, TextChunk } from '../models';
import { ChunkerService }    from './chunker.service';
import { Bm25Service }       from './bm25.service';
import { EmbeddingService }  from './embedding.service';
import { StateService }      from './state.service';
import { KbStorageService }  from './kb-storage.service';

@Injectable({ providedIn: 'root' })
export class RagService {

  stats = signal<RagStats>({
    totalChunks: 0, indexedChunks: 0,
    embedStatus: 'idle', embedProgress: 0,
    lastQueryMs: 0, mode: 'hybrid'
  });

  // In-memory stores (source of truth for fast retrieval; mirrored to KbStore)
  private _chunks  = new Map<string, TextChunk>();
  private _vectors = new Map<string, number[]>();

  /** Resolves once the persisted index has been loaded from the active tier. */
  private _ready: Promise<void>;

  constructor(
    private chunker:  ChunkerService,
    private bm25:     Bm25Service,
    private embedSvc: EmbeddingService,
    private state:    StateService,
    private kb:       KbStorageService,
  ) {
    this._ready = this._init();
  }

  private async _init(): Promise<void> {
    await this.kb.init();
    await this._loadFromStore();
    this._syncStats();
  }

  /** Await this before any read that depends on the persisted index being loaded. */
  ready(): Promise<void> { return this._ready; }

  // ── Index documents ─────────────────────────────────────
  async indexDocuments(docs: KbDocument[]): Promise<void> {
    // Filter by role access
    const allowed = docs.filter(d => this.state.canAccess(d.sensitivity));
    const cfg = this.state.ragConfig();

    // Chunk all allowed docs
    const allChunks: TextChunk[] = [];
    for (const doc of allowed) {
      const docChunks = this.chunker.chunk(doc, cfg.chunkSize, cfg.overlap);
      for (const c of docChunks) this._chunks.set(c.id, c);
      allChunks.push(...docChunks);

      // Update doc as indexed
      this.state.updateDoc({ ...doc, chunkCount: docChunks.length, indexed: false });
    }

    // BM25 index (always — no model needed)
    this.bm25.build(allChunks);

    // Dense embeddings (optional — falls back gracefully)
    if (cfg.mode !== 'sparse') {
      this.stats.update(s => ({ ...s, embedStatus: 'loading' }));
      const loaded = await this.embedSvc.ensureLoaded();
      if (loaded) {
        let done = 0;
        for (const chunk of allChunks) {
          const vec = await this.embedSvc.embed(chunk.content);
          if (vec) this._vectors.set(chunk.id, vec);
          done++;
          this.stats.update(s => ({
            ...s,
            indexedChunks: done,
            embedProgress: Math.round((done / allChunks.length) * 100)
          }));
        }
        this.stats.update(s => ({ ...s, embedStatus: 'ready' }));

        // Mark docs indexed
        for (const doc of allowed) this.state.updateDoc({ ...doc, indexed: true });
      } else {
        this.stats.update(s => ({ ...s, embedStatus: 'error' }));
      }
    }

    await this._saveToStore();
    this._syncStats();
  }

  async removeDocChunks(docId: string): Promise<void> {
    for (const [id, chunk] of this._chunks) {
      if (chunk.docId === docId) {
        this._chunks.delete(id);
        this._vectors.delete(id);
      }
    }
    this.bm25.build([...this._chunks.values()]);
    await this._saveToStore();
    this._syncStats();
  }

  async clearAll(): Promise<void> {
    this._chunks.clear();
    this._vectors.clear();
    this.bm25.build([]);
    await this.kb.clearAll();
    this._syncStats();
  }

  // ── Retrieve ─────────────────────────────────────────────
  async retrieve(query: string): Promise<RetrievedChunk[]> {
    await this._ready;
    if (!this._chunks.size && !this.bm25.hasIndex) return [];
    const t0  = performance.now();
    const cfg = this.state.ragConfig();

    let denseResults:  { id: string; score: number }[] = [];
    let sparseResults: { id: string; score: number }[] = [];

    // BM25 sparse
    if (cfg.mode !== 'dense') {
      sparseResults = this.bm25.search(query, cfg.topK * 3).map(r => ({ id: r.chunk.id, score: r.score }));
    }

    // Dense vector search
    if (cfg.mode !== 'sparse' && this.embedSvc.isReady && this._vectors.size > 0) {
      const qVec = await this.embedSvc.embed(query);
      if (qVec) {
        const scored: { id: string; score: number }[] = [];
        for (const [id, vec] of this._vectors) {
          scored.push({ id, score: EmbeddingService.cosine(qVec, vec) });
        }
        denseResults = scored.sort((a, b) => b.score - a.score).slice(0, cfg.topK * 3);
      }
    }

    // Reciprocal Rank Fusion
    const fused = this._rrf(denseResults, sparseResults, 60);

    const results: RetrievedChunk[] = [];
    let rank = 0;
    for (const r of fused.slice(0, cfg.topK)) {
      if (r.hybridScore < cfg.minScore) continue;
      const chunk = this._chunks.get(r.chunkId);
      if (!chunk) continue;
      results.push({
        chunk,
        denseScore:  r.denseScore,
        sparseScore: r.sparseScore,
        hybridScore: r.hybridScore,
        rank: ++rank
      });
    }

    this.stats.update(s => ({ ...s, lastQueryMs: Math.round(performance.now() - t0) }));
    return results;
  }

  buildContext(chunks: RetrievedChunk[]): string {
    if (!chunks.length) return '';
    const mode = this.state.ragConfig().mode;
    const modeStr = mode === 'hybrid' ? 'Dense (MiniLM) + Sparse (BM25) via RRF'
                  : mode === 'dense'  ? 'Dense semantic (MiniLM embeddings)'
                  : 'Sparse keyword (BM25)';

    let ctx = `--- HYBRID RAG RETRIEVED CONTEXT ---\n`;
    ctx += `Retrieval method: ${modeStr} | Top-${chunks.length} chunks\n\n`;
    for (const r of chunks) {
      ctx += `[Rank ${r.rank} | Source: "${r.chunk.docName}" | Hybrid score: ${r.hybridScore.toFixed(3)}`;
      if (r.denseScore > 0)  ctx += ` | Dense: ${r.denseScore.toFixed(3)}`;
      if (r.sparseScore > 0) ctx += ` | Sparse: ${r.sparseScore.toFixed(3)}`;
      ctx += `]\n${r.chunk.content}\n\n`;
    }
    ctx += `--- END RAG CONTEXT ---\n\nInstructions: Answer using the retrieved context above. Cite the source document name when referencing specific information. If context is insufficient, supplement with your Singtel CSI knowledge base.`;
    return ctx;
  }

  // ── RRF ─────────────────────────────────────────────────
  private _rrf(
    dense:  { id: string; score: number }[],
    sparse: { id: string; score: number }[],
    k = 60
  ): { chunkId: string; denseScore: number; sparseScore: number; hybridScore: number }[] {
    const map = new Map<string, { d: number; s: number; h: number }>();
    dense.forEach(({ id, score }, rank)  => {
      const e = map.get(id) || { d: 0, s: 0, h: 0 };
      e.d = score; e.h += 1 / (k + rank + 1); map.set(id, e);
    });
    sparse.forEach(({ id, score }, rank) => {
      const e = map.get(id) || { d: 0, s: 0, h: 0 };
      e.s = score; e.h += 1 / (k + rank + 1); map.set(id, e);
    });
    return [...map.entries()]
      .map(([chunkId, v]) => ({ chunkId, denseScore: v.d, sparseScore: v.s, hybridScore: v.h }))
      .sort((a, b) => b.hybridScore - a.hybridScore);
  }

  // ── Storage (tiered: localStorage → IndexedDB overflow via KbStore) ──────
  private async _saveToStore(): Promise<void> {
    try {
      await this.kb.saveChunks([...this._chunks.values()]);
      await this.kb.saveVectors([...this._vectors.entries()]);
    } catch (e) { console.warn('RAG storage save failed', e); }
  }

  private async _loadFromStore(): Promise<void> {
    try {
      const chunks = await this.kb.loadChunks();
      if (chunks.length) {
        this._chunks = new Map(chunks.map(c => [c.id, c]));
        this.bm25.build(chunks);
      }
      const vecs = await this.kb.loadVectors();
      if (vecs.length) {
        this._vectors = new Map(vecs);
        this.stats.update(s => ({ ...s, embedStatus: 'ready', indexedChunks: this._vectors.size }));
      }
    } catch (e) { console.warn('RAG storage load failed', e); }
  }

  private _syncStats(): void {
    const cfg = this.state.ragConfig();
    this.stats.update(s => ({
      ...s,
      totalChunks:   this._chunks.size,
      indexedChunks: this._vectors.size,
      mode:          cfg.mode,
    }));
  }

  get totalChunks()   { return this._chunks.size; }
  get indexedChunks() { return this._vectors.size; }
  get hasIndex()      { return this._chunks.size > 0; }
  storageBytes(): number {
    return (localStorage.getItem('csinora_chunks')?.length || 0) * 2
         + (localStorage.getItem('csinora_vectors')?.length || 0) * 2;
  }
}
