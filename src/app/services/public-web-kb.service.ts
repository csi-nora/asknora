import { Injectable, signal } from '@angular/core';
import { STOP_WORDS } from '../data/local-kb.data';

export interface PublicWebKbPage {
  url: string;
  title: string;
  text: string;
  /** Optional crawl hints from `scrape-singtel-csi.mjs` (e.g. host family, seed) */
  tags?: string[];
}

interface PublicWebKbFile {
  source?: string;
  generatedAt?: string | null;
  pages: PublicWebKbPage[];
}

@Injectable({ providedIn: 'root' })
export class PublicWebKbService {
  readonly status = signal<'idle' | 'loaded' | 'missing' | 'error'>('idle');
  readonly generatedAt = signal<string | null>(null);
  readonly pageCount = signal<number>(0);

  private pages: PublicWebKbPage[] = [];
  private loadOnce: Promise<void> | null = null;

  private readonly KEEP_SHORT_TOKENS = new Set(['ai', 'ot', 'it', '5g']);

  /** Single-flight fetch so callers can await before building RAG context */
  load(): Promise<void> {
    if (!this.loadOnce) {
      this.loadOnce = (async () => {
        this.status.set('idle');
        try {
          const r = await fetch('/public-kb.json', { cache: 'no-store' });
          if (!r.ok) {
            this.status.set('missing');
            this.pages = [];
            this.pageCount.set(0);
            return;
          }
          const json = (await r.json()) as PublicWebKbFile;
          this.pages = Array.isArray(json.pages) ? json.pages : [];
          this.generatedAt.set((json.generatedAt as string) ?? null);
          this.pageCount.set(this.pages.length);
          this.status.set(this.pages.length ? 'loaded' : 'missing');
        } catch {
          this.status.set('error');
          this.pages = [];
          this.pageCount.set(0);
        }
      })();
    }
    return this.loadOnce;
  }

  /** Snapshot of loaded pages for RAG corpus indexing (after `load()`). */
  getPagesSnapshot(): PublicWebKbPage[] {
    return this.pages.slice();
  }

  search(query: string, topN = 2): PublicWebKbPage[] {
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    const scored = this.pages
      .map(p => ({ p, score: this.scorePage(p, tokens) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, topN).map(x => x.p);
  }

  buildContext(query: string, topN = 2): string {
    const hits = this.search(query, topN);
    if (hits.length === 0) return '';

    let ctx = '--- SINGTEL CSI PUBLIC WEBSITE (scraped) ---\n';
    for (const h of hits) {
      const perPageCap = 2800;
      const body = h.text.length > perPageCap ? h.text.slice(0, perPageCap) + '…[truncated]' : h.text;
      ctx += `\n[Page: ${h.title || '(untitled)'}]\nURL: ${h.url}\n${body}\n[END PAGE]\n`;
    }
    ctx += '--- END PUBLIC WEBSITE ---\n\nUse only the above public-domain content when referencing the Singtel CSI website. Cite URLs when relevant.';
    return ctx;
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .map(w => w.trim())
      .filter(Boolean)
      .filter(w => (w.length > 2 || this.KEEP_SHORT_TOKENS.has(w)) && !STOP_WORDS.has(w));
  }

  private scorePage(p: PublicWebKbPage, tokens: string[]): number {
    const hay = (p.title + '\n' + p.text).toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
    }
    return score;
  }
}

