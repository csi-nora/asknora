import { Injectable, signal } from '@angular/core';
import { EmbedStatus } from '../models';

/**
 * Dense-embedding service (Xenova/all-MiniLM-L6-v2 via transformers.js).
 *
 * OFFLINE-FIRST: it loads the runtime, WASM backend and model from the SAME
 * origin (vendored under /vendor/transformers and /models by the Angular build),
 * so it works on an air-gapped VM with NO internet. If the local assets are
 * missing (e.g. a dev build that didn't run scripts/fetch-embedding-model), it
 * gracefully falls back to the public CDN so the online path still works.
 */
@Injectable({ providedIn: 'root' })
export class EmbeddingService {
  status   = signal<EmbedStatus>('idle');
  progress = signal<number>(0);
  /** Which source actually loaded the model: 'local' (offline) | 'remote' (CDN) | null */
  source   = signal<'local' | 'remote' | null>(null);

  private static readonly REMOTE_LIB  = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';
  private static readonly MODEL_ID    = 'Xenova/all-MiniLM-L6-v2';

  private _pipe: any = null;
  private _loading = false;

  get isReady() { return this.status() === 'ready'; }

  /**
   * App base path from <base href> so vendored assets resolve correctly whether
   * the app is served at the origin root (nginx: "/") or under a sub-path
   * (GitHub Pages: "/asknora/"). Returns a value with a trailing slash.
   */
  private _basePath(): string {
    try {
      const p = new URL(document.baseURI).pathname;
      return p.endsWith('/') ? p : p + '/';
    } catch { return '/'; }
  }

  async ensureLoaded(): Promise<boolean> {
    if (this._pipe) return true;
    if (this._loading) {
      return new Promise(resolve => {
        const check = setInterval(() => {
          if (this._pipe) { clearInterval(check); resolve(true); }
          if (this.status() === 'error') { clearInterval(check); resolve(false); }
        }, 200);
      });
    }

    this._loading = true;
    this.status.set('loading');
    this.progress.set(0);

    try {
      // Try same-origin vendored assets first (works fully offline), then CDN.
      if (await this._tryLoad('local'))  return true;
      if (await this._tryLoad('remote')) return true;
      this.status.set('error');
      return false;
    } finally {
      this._loading = false;
    }
  }

  private async _tryLoad(mode: 'local' | 'remote'): Promise<boolean> {
    try {
      const base   = this._basePath();
      const libUrl = mode === 'local'
        ? `${base}vendor/transformers/transformers.min.js`
        : EmbeddingService.REMOTE_LIB;
      // Dynamic import via Function() so TS/Angular don't try to resolve the URL at build time.
      const { pipeline, env } = await (Function(`return import("${libUrl}")`)() as Promise<any>);

      if (mode === 'local') {
        // Self-hosted, no network: model + wasm come from our own origin.
        env.allowLocalModels  = true;
        env.allowRemoteModels = false;
        env.localModelPath    = `${base}models/`;
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.wasmPaths = `${base}vendor/transformers/`;
          // Single-threaded: threaded WASM needs cross-origin isolation (SAB) we
          // don't enable; this also means we only ship the non-threaded binaries.
          env.backends.onnx.wasm.numThreads = 1;
        }
      } else {
        // Public CDN fallback (online machines / when local assets are absent).
        env.allowLocalModels  = false;
        env.allowRemoteModels = true;
        env.useBrowserCache   = true;
      }

      this._pipe = await pipeline('feature-extraction', EmbeddingService.MODEL_ID, {
        quantized: true,
        progress_callback: (p: any) => {
          if (p?.progress != null) this.progress.set(Math.round(p.progress));
        }
      });
      this.status.set('ready');
      this.progress.set(100);
      this.source.set(mode);
      console.info(`[Embeddings] Loaded MiniLM from ${mode === 'local' ? 'self-hosted (offline)' : 'CDN'}.`);
      return true;
    } catch (e) {
      console.warn(`[Embeddings] ${mode} load failed:`, e);
      return false;
    }
  }

  async embed(text: string): Promise<number[] | null> {
    if (!this._pipe) return null;
    try {
      const out = await this._pipe(text.slice(0, 512), { pooling: 'mean', normalize: true });
      return Array.from(out.data as Float32Array);
    } catch (e) {
      console.warn('[Embeddings] Embed error:', e);
      return null;
    }
  }

  static cosine(a: number[], b: number[]): number {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i]; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
  }
}
