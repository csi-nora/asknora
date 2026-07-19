import { Injectable } from '@angular/core';
import { KbDocument, Sensitivity } from '../models';
import { StateService } from './state.service';
import { AuditService } from './audit.service';
import { RagService }   from './rag.service';

const ALLOWED = ['pdf','txt','md','csv','html','htm'];
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_CHARS = 12000;

declare const pdfjsLib: any;

@Injectable({ providedIn: 'root' })
export class DocumentService {
  constructor(
    private state: StateService,
    private audit: AuditService,
    private rag:   RagService,
  ) {
    this._configurePdfWorker();
  }

  /** Point pdf.js at its web worker. Safe to call repeatedly; no-op if the
   *  library isn't present yet (we retry lazily right before parsing). */
  private _configurePdfWorker(): void {
    if (typeof pdfjsLib !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      // Self-hosted (same origin) so PDF parsing works fully offline / air-gapped.
      // Resolve against <base href> so it works at root (nginx) and under a
      // sub-path (GitHub Pages: /asknora/).
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        new URL('vendor/pdfjs/pdf.worker.min.js', document.baseURI).href;
    }
  }

  async ingestFiles(files: FileList | File[], sensitivity: Sensitivity): Promise<string[]> {
    const errors: string[] = [];
    const newDocs: KbDocument[] = [];

    for (const file of Array.from(files)) {
      const result = await this._ingestOne(file, sensitivity);
      if (typeof result === 'string') errors.push(result);
      else newDocs.push(result);
    }

    // Index new docs in RAG
    if (newDocs.length > 0) {
      await this.rag.indexDocuments(this.state.docs);
    }
    return errors;
  }

  async removeDoc(id: string): Promise<void> {
    await this.rag.removeDocChunks(id);
    this.state.removeDoc(id);
    this.audit.log('Doc Removed', 'Document removed from KB and RAG index', 'internal');
  }

  private async _ingestOne(file: File, sensitivity: Sensitivity): Promise<KbDocument | string> {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED.includes(ext)) return `${file.name} — unsupported type`;
    if (file.size > MAX_SIZE)   return `${file.name} exceeds 10 MB`;

    let raw = '';
    try {
      raw = ext === 'pdf' ? await this._pdfToText(file) : await this._readText(file);
    } catch (e) { return `Failed to read ${file.name}: ${(e as Error).message}`; }

    const content = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) + '…[truncated]' : raw;
    const doc: KbDocument = {
      id:         'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
      name:       file.name,
      type:       ext,
      size:       file.size,
      content,
      sensitivity,
      uploadedAt: new Date().toISOString(),
      chunkCount: 0,
      indexed:    false,
    };
    this.state.addDoc(doc);
    this.audit.log('Doc Ingested', `${file.name} (${this.fmtSize(file.size)})`, sensitivity);
    return doc;
  }

  private _readText(file: File): Promise<string> {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res((e.target as FileReader).result as string);
      r.onerror = () => rej(new Error('Read failed'));
      r.readAsText(file, 'UTF-8');
    });
  }

  private async _pdfToText(file: File): Promise<string> {
    if (typeof pdfjsLib === 'undefined') {
      throw new Error('PDF reader unavailable (pdf.js failed to load — check network/CDN access)');
    }
    this._configurePdfWorker();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    let text = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 40); i++) {
      const page = await pdf.getPage(i);
      const tc   = await page.getTextContent();
      text += tc.items.map((x: any) => x.str).join(' ') + '\n';
    }
    return text.trim() || '[No extractable text in PDF]';
  }

  fmtSize(b: number): string {
    return b < 1024 ? '<1KB' : b < 1048576 ? Math.round(b/1024)+'KB' : (b/1048576).toFixed(1)+'MB';
  }
  icon(t: string): string {
    return ({pdf:'📑',txt:'📄',md:'📝',csv:'📊',html:'🌐',htm:'🌐'} as any)[t] || '📄';
  }
}
