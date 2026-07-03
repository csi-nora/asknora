import { Component, signal } from '@angular/core';
import { CommonModule }     from '@angular/common';
import { StateService }     from '../../services/state.service';
import { DocumentService }  from '../../services/document.service';
import { AuditService }     from '../../services/audit.service';
import { RagService }       from '../../services/rag.service';
import { EmbeddingService } from '../../services/embedding.service';
import { SECTORS, SECTOR_KEYS } from '../../data/sectors.data';
import { Sensitivity } from '../../models';

@Component({
  selector: 'app-sector-panel',
  standalone: true,
  imports: [CommonModule],
  template: `
<div class="sp">
  <div class="panel-label">Business Sector</div>
  <button *ngFor="let k of keys" class="sector-btn" [class.active]="st.sector()===k" (click)="pick(k)">
    <span class="si">{{ S[k].icon }}</span>
    <span class="sn">{{ S[k].name }}</span>
    <span class="sc">{{ S[k].count }}</span>
  </button>

  <div class="divider"></div>
  <div class="panel-label">Sensitivity</div>
  <button *ngFor="let s of sens" class="sector-btn" [class.active]="st.sensitivity()===s.k" (click)="setSens(s.k)">
    <span class="si" style="font-size:11px">{{ s.icon }}</span>
    <span class="sn">{{ s.label }}</span>
  </button>

  <div class="divider"></div>
  <div class="panel-label kb-lbl">
    Knowledge Base
    <span class="kb-count">{{ st.docs.length }} doc{{ st.docs.length!==1?'s':'' }}</span>
  </div>

  <!-- RAG status mini bar -->
  <div class="rag-mini" *ngIf="rag.totalChunks > 0">
    <div class="rag-mini-row">
      <span style="color:var(--blue)">🧠 RAG Index</span>
      <span style="color:var(--dim)">{{ rag.totalChunks }} chunks</span>
    </div>
    <div *ngIf="rag.indexedChunks > 0" class="rag-mini-row">
      <span style="color:var(--dim)">Dense vectors</span>
      <span style="color:var(--green)">{{ rag.indexedChunks }} ✓</span>
    </div>
    <div *ngIf="embedSvc.status()==='loading'" class="embed-progress" style="margin:4px 0;padding:4px 8px">
      <div class="embed-spinner"></div>
      <span>Embedding {{ embedSvc.progress() }}%</span>
    </div>
  </div>

  <!-- Upload zone -->
  <div class="upload-zone" [class.dragover]="over()" (click)="fi.click()"
       (dragover)="$event.preventDefault();_over.set(true)"
       (dragleave)="_over.set(false)"
       (drop)="onDrop($event)">
    <div style="font-size:22px;margin-bottom:4px">📄</div>
    <div class="uz-text"><strong>Drop files or click to upload</strong>PDF · TXT · MD · CSV · HTML</div>
  </div>
  <input #fi type="file" multiple accept=".pdf,.txt,.md,.csv,.html,.htm" hidden (change)="onFiles($event)">

  <!-- Progress bar -->
  <div class="up-prog" *ngIf="uploading()">
    <div class="up-prog-bar" [style.width.%]="upPct()"></div>
  </div>

  <!-- Doc list -->
  <div class="doc-list">
    <div class="no-items" *ngIf="!st.docs.length">No documents ingested yet</div>
    <div class="doc-item" *ngFor="let d of st.docs; trackBy: trackId">
      <span>{{ docSvc.icon(d.type) }}</span>
      <div class="di">
        <div class="dn">{{ d.name }}</div>
        <div class="dm">{{ docSvc.fmtSize(d.size) }} · {{ d.type.toUpperCase() }}</div>
        <div class="dm" *ngIf="d.chunkCount">
          {{ d.chunkCount }} chunks
          <span *ngIf="d.indexed" style="color:var(--green)"> · indexed ✓</span>
          <span *ngIf="!d.indexed" style="color:var(--amber)"> · BM25 only</span>
        </div>
        <span class="si" [ngClass]="'si-'+d.sensitivity">{{ d.sensitivity.toUpperCase() }}</span>
      </div>
      <button class="doc-del" (click)="remove(d.id)">✕</button>
    </div>
  </div>
</div>
  `,
  styles: [`
    :host{display:contents}
    .sp{border-right:1px solid var(--border);overflow-y:auto;padding:14px 10px;
      display:flex;flex-direction:column;gap:4px;
      &::-webkit-scrollbar{width:3px}&::-webkit-scrollbar-thumb{background:var(--border)}}
    .sector-btn{display:flex;align-items:center;gap:7px;padding:8px 9px;border-radius:10px;
      border:1px solid transparent;background:transparent;cursor:pointer;color:var(--muted);
      font-family:var(--fb);font-size:12px;font-weight:400;transition:.2s;text-align:left;width:100%;
      &:hover{background:var(--card);color:var(--text);border-color:var(--border)}
      &.active{background:linear-gradient(135deg,rgba(224,0,26,.12),rgba(224,0,26,.05));
        border-color:var(--border-a);color:var(--text) .si{color:var(--red)} .sc{background:var(--red-glow);color:var(--red)}}}
    .sector-btn.active .si{color:var(--red)}
    .sector-btn.active .sc{background:var(--red-glow);color:var(--red)}
    .si{font-size:15px;width:20px;text-align:center;flex-shrink:0}
    .sn{font-weight:500;flex:1}
    .sc{font-size:10px;padding:1px 5px;background:var(--card);border-radius:8px;color:var(--dim)}
    .kb-lbl{display:flex;align-items:center;justify-content:space-between;padding-right:4px}
    .kb-count{font-size:10px;color:var(--dim);font-weight:400;text-transform:none;letter-spacing:0}
    .rag-mini{padding:6px 8px;background:rgba(59,130,246,.06);border:1px solid rgba(59,130,246,.15);
      border-radius:8px;font-size:10px;margin:2px 0}
    .rag-mini-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}
    .upload-zone{border:1.5px dashed var(--border);border-radius:10px;padding:12px;text-align:center;
      cursor:pointer;transition:.2s;margin:4px 0;
      &:hover,.dragover{border-color:var(--border-a);background:rgba(224,0,26,.04)}}
    .uz-text{font-size:11px;color:var(--muted);line-height:1.5 strong{color:var(--text);display:block;font-size:12px}}
    .uz-text strong{color:var(--text);display:block;font-size:12px}
    .doc-list{display:flex;flex-direction:column;gap:4px}
    .doc-item{display:flex;align-items:flex-start;gap:7px;padding:7px 8px;background:var(--surface);
      border:1px solid var(--border);border-radius:8px;font-size:11px;transition:.15s;
      &:hover{border-color:var(--border-a)}}
    .di{flex:1;min-width:0} .dn{color:var(--text);font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .dm{color:var(--dim);font-size:10px;margin-top:1px}
    .doc-del{background:transparent;border:none;color:var(--dim);cursor:pointer;font-size:11px;
      padding:2px;flex-shrink:0;&:hover{color:var(--red)}}
  `]
})
export class SectorPanelComponent {
  S    = SECTORS;
  keys = SECTOR_KEYS;
  sens = [
    { k: 'public'      as Sensitivity, icon: '🟢', label: 'Public' },
    { k: 'internal'    as Sensitivity, icon: '🔵', label: 'Internal' },
    { k: 'confidential'as Sensitivity, icon: '🟡', label: 'Confidential' },
  ];
  _over    = signal(false);
  uploading = signal(false);
  upPct     = signal(0);
  over = this._over;

  constructor(
    public st:  StateService,
    public docSvc: DocumentService,
    private au: AuditService,
    public rag: RagService,
    public embedSvc: EmbeddingService,
  ) {}

  pick(k: string) {
    this.st.sector.set(k);
    this.st.clearMessages();
    this.au.log('Sector Selected', SECTORS[k].name, 'public');
  }
  setSens(s: Sensitivity) {
    this.st.sensitivity.set(s);
    this.au.log('Sensitivity Set', s, s);
  }
  async onFiles(e: Event) {
    const files = (e.target as HTMLInputElement).files;
    if (files) await this._ingest(files);
    (e.target as HTMLInputElement).value = '';
  }
  onDrop(e: DragEvent) {
    e.preventDefault(); this._over.set(false);
    if (e.dataTransfer?.files) this._ingest(e.dataTransfer.files);
  }
  private async _ingest(files: FileList) {
    this.uploading.set(true); this.upPct.set(20);
    await this.docSvc.ingestFiles(files, this.st.sensitivity());
    this.upPct.set(100);
    setTimeout(() => { this.uploading.set(false); this.upPct.set(0); }, 500);
  }
  remove(id: string) { this.docSvc.removeDoc(id); }
  trackId = (_: number, d: any) => d.id;
}
