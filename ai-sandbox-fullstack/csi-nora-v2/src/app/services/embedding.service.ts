import { Injectable, signal } from '@angular/core';
import { EmbedStatus } from '../models';

@Injectable({ providedIn: 'root' })
export class EmbeddingService {
  status   = signal<EmbedStatus>('idle');
  progress = signal<number>(0);

  private _pipe: any = null;
  private _loading = false;

  get isReady() { return this.status() === 'ready'; }

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
      // Dynamic CDN import (avoid TS resolving the URL as a module path)
      const cdn = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1';
      const { pipeline, env } = await (Function(`return import("${cdn}")`)() as Promise<any>);
      env.allowLocalModels = false;
      env.useBrowserCache  = true;

      this._pipe = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        {
          quantized: true,
          progress_callback: (p: any) => {
            if (p?.progress != null) this.progress.set(Math.round(p.progress));
          }
        }
      );
      this.status.set('ready');
      this.progress.set(100);
      return true;
    } catch (e) {
      console.warn('[Embeddings] Load failed — using sparse-only mode:', e);
      this.status.set('error');
      return false;
    } finally {
      this._loading = false;
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
