import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  CorpusBundleDocument,
  CorpusBundleFile,
  CorpusManifest,
  KbDocument,
  Sensitivity,
} from '../models';
import { LOCAL_KB } from '../data/local-kb.data';
import { StateService } from './state.service';
import { PublicWebKbService } from './public-web-kb.service';
import { RagService } from './rag.service';
import { AuditService } from './audit.service';

function normSensitivity(s: string | undefined): Sensitivity {
  if (s === 'public' || s === 'internal' || s === 'confidential') {
    return s;
  }
  return 'internal';
}

/**
 * Builds a unified logical document list for RAG: user uploads + local KB + public web scrape
 * + optional JSON bundles listed in `/corpus-manifest.json` (e.g. CI output from other repos).
 */
@Injectable({ providedIn: 'root' })
export class CorpusAggregatorService {
  readonly status = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  /** Last aggregate: counts by source category */
  readonly lastBreakdown = signal<{ uploads: number; localKb: number; publicWeb: number; bundles: number } | null>(null);

  constructor(
    private http: HttpClient,
    private state: StateService,
    private publicWeb: PublicWebKbService,
    private rag: RagService,
    private audit: AuditService,
  ) {}

  /** Merge all sources into `KbDocument[]` (does not run chunk/embed). */
  async aggregateAllDocuments(): Promise<KbDocument[]> {
    const out: KbDocument[] = [];

    const uploads = this.state.docs.map(d => ({ ...d }));
    out.push(...uploads);

    const localDocs = this.localKbToDocuments();
    out.push(...localDocs);

    await this.publicWeb.load();
    const webDocs = this.publicWebToDocuments();
    out.push(...webDocs);

    const bundleDocs = await this.fetchManifestBundles();
    out.push(...bundleDocs);

    this.lastBreakdown.set({
      uploads: uploads.length,
      localKb: localDocs.length,
      publicWeb: webDocs.length,
      bundles: bundleDocs.length,
    });

    return out;
  }

  /** Chunk + BM25 + optional dense index over the full merged corpus. */
  async reindexFullCorpus(): Promise<void> {
    this.status.set('loading');
    try {
      const docs = await this.aggregateAllDocuments();
      await this.rag.indexDocuments(docs);
      const b = this.lastBreakdown();
      const detail = b
        ? `uploads=${b.uploads}, localKb=${b.localKb}, publicWeb=${b.publicWeb}, bundles=${b.bundles} → ${this.rag.totalChunks} chunks`
        : `${this.rag.totalChunks} chunks`;
      this.audit.log('Full corpus indexed', detail, 'internal');
      this.status.set('ready');
    } catch (e) {
      this.status.set('error');
      this.audit.log('Full corpus index failed', (e as Error).message || String(e), 'internal');
      throw e;
    }
  }

  private localKbToDocuments(): KbDocument[] {
    const out: KbDocument[] = [];
    const now = new Date().toISOString();
    for (const [sector, chunks] of Object.entries(LOCAL_KB)) {
      for (const ch of chunks) {
        const content = `# ${ch.title}\n\n${ch.answer}`;
        out.push({
          id: `local-kb-${ch.id}`,
          name: `Local KB · ${sector} · ${ch.title}`,
          type: 'txt',
          size: content.length,
          content,
          sensitivity: 'internal',
          uploadedAt: now,
          chunkCount: 0,
          indexed: false,
        });
      }
    }
    return out;
  }

  private publicWebToDocuments(): KbDocument[] {
    const pages = this.publicWeb.getPagesSnapshot();
    if (!pages.length) {
      return [];
    }
    const now = new Date().toISOString();
    return pages.map((p, i) => {
      const content = `${p.title}\n\n${p.text}`.trim();
      return {
        id: `pub-web-${i}-${this.shortHash(p.url)}`,
        name: `Public site · ${p.title || p.url}`,
        type: 'htm',
        size: content.length,
        content,
        sensitivity: 'public' as const,
        uploadedAt: now,
        chunkCount: 0,
        indexed: false,
      };
    });
  }

  private async fetchManifestBundles(): Promise<KbDocument[]> {
    let manifest: CorpusManifest;
    try {
      manifest = await firstValueFrom(this.http.get<CorpusManifest>('/corpus-manifest.json'));
    } catch {
      return [];
    }
    if (!manifest?.bundles?.length) {
      return [];
    }
    const out: KbDocument[] = [];
    const now = new Date().toISOString();
    for (const b of manifest.bundles) {
      if (!b.id || !b.url) {
        continue;
      }
      try {
        const file = await firstValueFrom(this.http.get<CorpusBundleFile>(b.url));
        const docs = file?.documents ?? [];
        docs.forEach((d: CorpusBundleDocument, i: number) => {
          const sens = normSensitivity(d.sensitivity);
          out.push({
            id: `corpus-${b.id}-${i}-${this.shortHash(d.name)}`,
            name: `${b.name ?? b.id} · ${d.name}`,
            type: 'txt',
            size: d.content.length,
            content: d.content,
            sensitivity: sens,
            uploadedAt: now,
            chunkCount: 0,
            indexed: false,
          });
        });
      } catch {
        /* skip broken bundle */
      }
    }
    return out;
  }

  private shortHash(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36).slice(0, 8);
  }
}
