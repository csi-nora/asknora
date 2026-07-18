import { Component, computed } from '@angular/core';
import { CommonModule, TitleCasePipe } from '@angular/common';
import { StateService }  from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { AuditService }   from '../../services/audit.service';
import { ApiService, PROV_COLOR, PROV_LABEL } from '../../services/api.service';
import { RagService }     from '../../services/rag.service';
import { EmbeddingService } from '../../services/embedding.service';
import { SECTORS }        from '../../data/sectors.data';

@Component({
  selector: 'app-info-panel',
  standalone: true,
  imports: [CommonModule, TitleCasePipe],
  template: `
<div class="ip">

  <!-- Security -->
  <div class="info-section">
    <div class="info-title">🔐 Security Status</div>
    <div class="sec-item"><span class="sec-label">IAM Auth</span>
      <div class="sec-status"><div class="status-dot" style="background:var(--green);box-shadow:0 0 6px rgba(34,197,94,.5)"></div><span style="color:var(--green)">Active</span></div></div>
    <div class="sec-item"><span class="sec-label">Role Filter</span>
      <div class="sec-status"><div class="status-dot" style="background:var(--green)"></div><span style="color:var(--green)">{{ st.role() }}</span></div></div>
    <div class="sec-item"><span class="sec-label">Output Guard</span>
      <div class="sec-status"><div class="status-dot" style="background:var(--green)"></div><span style="color:var(--green)">Active</span></div></div>
    <div class="sec-item"><span class="sec-label">Provider</span>
      <div class="sec-status"><div class="status-dot" [style.background]="provColor()"></div><span>{{ provLabel() }}</span></div></div>
    <div class="sec-item"><span class="sec-label">Mode</span>
      <div class="sec-status"><div class="status-dot" [style.background]="modeDot()"></div><span [style.color]="modeColor()">{{ st.hybridMode() | titlecase }}</span></div></div>
  </div>

  <!-- RAG Stats -->
  <div class="info-section">
    <div class="info-title">
      🧠 RAG Pipeline
      <button class="btn-sm" (click)="st.activeModal.set('rag-config')">Configure</button>
    </div>

    <div class="rag-stats-grid">
      <div class="rag-stat-card">
        <div class="rag-stat-val">{{ rag.totalChunks }}</div>
        <div class="rag-stat-lbl">Total Chunks</div>
      </div>
      <div class="rag-stat-card">
        <div class="rag-stat-val" [style.color]="rag.indexedChunks>0?'var(--green)':'var(--dim)'">{{ rag.indexedChunks }}</div>
        <div class="rag-stat-lbl">Dense Indexed</div>
      </div>
      <div class="rag-stat-card">
        <div class="rag-stat-val" [style.color]="rag.stats().lastQueryMs>0?'var(--blue)':'var(--dim)'">
          {{ rag.stats().lastQueryMs > 0 ? rag.stats().lastQueryMs + 'ms' : '—' }}
        </div>
        <div class="rag-stat-lbl">Last Query</div>
      </div>
      <div class="rag-stat-card">
        <div class="rag-stat-val" style="font-size:13px;font-weight:600">{{ st.ragConfig().mode | titlecase }}</div>
        <div class="rag-stat-lbl">RAG Mode</div>
      </div>
    </div>

    <!-- Embed status -->
    <div class="embed-progress" *ngIf="embedSvc.status()==='loading'" style="margin-top:8px">
      <div class="embed-spinner"></div>
      <span>Embedding {{ embedSvc.progress() }}%</span>
    </div>
    <div *ngIf="embedSvc.status()==='ready'" style="font-size:10px;color:var(--green);margin-top:6px">
      ✓ Dense embeddings ready (all-MiniLM-L6-v2)
    </div>
    <div *ngIf="embedSvc.status()==='error'" style="font-size:10px;color:var(--amber);margin-top:6px">
      ⚠️ Embeddings unavailable — BM25 sparse only
    </div>
  </div>

  <!-- Session -->
  <div class="info-section">
    <div class="info-title">📋 Session</div>
    <div class="ctx-card"><div class="ctx-label">Sector</div>
      <div class="ctx-value">{{ sectorLabel() }}</div></div>
    <div class="ctx-card"><div class="ctx-label">Role</div>
      <div class="ctx-value">{{ st.role() }}</div></div>
    <div class="ctx-card"><div class="ctx-label">Model</div>
      <div class="ctx-value">{{ shortModel() }}</div></div>
    <div class="ctx-card"><div class="ctx-label">Messages</div>
      <div class="ctx-value">{{ st.msgCount() }}</div></div>
  </div>

  <!-- Audit log -->
  <div class="info-section" style="flex:1">
    <div class="info-title">🧾 Audit Log
      <button class="btn-sm" (click)="au.downloadCsv()">Export CSV</button>
    </div>
    <div class="audit-list">
      <div class="empty-state" *ngIf="!st.auditEntries.length">No activity yet</div>
      <div class="audit-entry" *ngFor="let e of st.auditEntries.slice(0,8); trackBy: trackTs">
        <div class="audit-time">{{ e.time }} · {{ e.role }}</div>
        <div class="audit-action">{{ e.action }}</div>
        <div class="audit-detail">{{ e.detail }}</div>
        <span class="si" [ngClass]="'si-'+e.sensitivity">{{ e.sensitivity.toUpperCase() }}</span>
      </div>
    </div>
  </div>

  <!-- Storage -->
  <div class="info-section">
    <div class="info-title">💾 Local Storage</div>
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
      <span style="color:var(--muted)">Used</span>
      <span style="color:var(--text);font-weight:500">{{ ss.fmt(ss.stats$.value.total) }} / 5 MB</span>
    </div>
    <div class="storage-bar-wrap">
      <div class="storage-bar" [ngClass]="barCls()" [style.width.%]="ss.stats$.value.pct"></div>
    </div>
    <div style="font-size:9px;color:var(--dim);text-align:right;margin-top:2px">
      Vec: {{ ss.fmt(ss.stats$.value.vecSize) }} · Docs: {{ ss.fmt(ss.stats$.value.docSize) }}
    </div>
    <div class="stor-clear-row" style="margin-top:6px">
      <button class="stor-clear-btn" (click)="clear('messages')">Msgs</button>
      <button class="stor-clear-btn" (click)="clear('docs')">Docs</button>
      <button class="stor-clear-btn" (click)="clear('vectors')">Vectors</button>
      <button class="stor-clear-btn" (click)="clear('audit')">Audit</button>
      <button class="stor-clear-btn danger" (click)="clear('all')">All</button>
    </div>
  </div>

</div>
  `,
  styles: [`:host{display:contents}
    .ip{border-left:1px solid var(--border);overflow-y:auto;display:flex;flex-direction:column;
      &::-webkit-scrollbar{width:3px}&::-webkit-scrollbar-thumb{background:var(--border)}}`]
})
export class InfoPanelComponent {
  constructor(
    public st: StateService,
    public ss: StorageService,
    public au: AuditService,
    private apiSvc: ApiService,
    public rag: RagService,
    public embedSvc: EmbeddingService,
  ) {}

  sectorLabel() {
    const s = this.st.sector();
    return s ? `${SECTORS[s].icon} ${SECTORS[s].name}` : '— Not selected —';
  }
  shortModel()  { return this.apiSvc.shortModel(this.st.api.provider); }
  provLabel()   { return PROV_LABEL[this.st.api.provider]; }
  provColor()   { return PROV_COLOR[this.st.api.provider]; }
  modeDot()     { return this.st.hybridMode()==='hybrid'?'var(--green)':this.st.hybridMode()==='local'?'var(--amber)':'var(--blue)'; }
  modeColor()   { return this.modeDot(); }
  barCls()      { const p=this.ss.stats$.value.pct; return p<70?'s-ok':p<90?'s-warn':'s-full'; }

  clear(t: any) {
    if (!confirm(`Clear ${t} from local storage?`)) return;
    this.ss.clearPartial(t);
    if (t==='messages'||t==='all') { this.st.clearMessages(); this.st.sector.set(null); }
    if (t==='docs'    ||t==='all') this.st.setDocs([]);
    if (t==='vectors' ||t==='all') this.rag.clearAll();
    if (t==='audit'   ||t==='all') this.st.setAudits([]);
  }

  trackTs = (_: number, e: any) => e.ts;
}
