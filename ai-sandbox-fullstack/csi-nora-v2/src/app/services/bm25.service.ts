import { Injectable } from '@angular/core';
import { TextChunk } from '../models';

const K1 = 1.5, B = 0.75;
const STOP = new Set(['the','a','an','and','or','in','on','at','to','for','of','with','is','are','was','were','it','this','that','from','by','as']);

@Injectable({ providedIn: 'root' })
export class Bm25Service {
  private chunks: TextChunk[] = [];
  private tokenized: string[][] = [];
  private df = new Map<string, number>();
  private idf: Record<string, number> = {};
  private avgdl = 0;

  tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w));
  }

  build(chunks: TextChunk[]): void {
    this.chunks = chunks;
    this.tokenized = chunks.map(c => this.tokenize(c.content));
    const N = chunks.length;
    const totalLen = this.tokenized.reduce((s, d) => s + d.length, 0);
    this.avgdl = N > 0 ? totalLen / N : 1;

    this.df.clear();
    for (const doc of this.tokenized) {
      for (const term of new Set(doc)) this.df.set(term, (this.df.get(term) || 0) + 1);
    }
    this.idf = {};
    for (const [term, freq] of this.df) {
      this.idf[term] = Math.log((N - freq + 0.5) / (freq + 0.5) + 1);
    }
  }

  search(query: string, topK = 10): { chunk: TextChunk; score: number }[] {
    if (!this.chunks.length) return [];
    const tokens = this.tokenize(query);
    const scores = new Array(this.chunks.length).fill(0);

    for (const qt of tokens) {
      const idf = this.idf[qt];
      if (!idf) continue;
      this.tokenized.forEach((doc, i) => {
        const tf = doc.filter(t => t === qt).length;
        if (tf === 0) return;
        const dl = doc.length;
        scores[i] += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * dl / this.avgdl));
      });
    }

    const max = Math.max(...scores, 1e-9);
    return scores
      .map((s, i) => ({ chunk: this.chunks[i], score: s / max }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  get hasIndex() { return this.chunks.length > 0; }
  get chunkCount() { return this.chunks.length; }
}
