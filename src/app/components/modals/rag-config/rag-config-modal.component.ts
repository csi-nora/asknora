import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { StateService } from '../../../services/state.service';
import { RagService }   from '../../../services/rag.service';
import { EmbeddingService } from '../../../services/embedding.service';
import { AuditService } from '../../../services/audit.service';
import { CorpusAggregatorService } from '../../../services/corpus-aggregator.service';
import { RagConfig, RagMode } from '../../../models';

@Component({
  selector: 'app-rag-config-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="modal-overlay" (click)="close()">
<div class="modal" (click)="$event.stopPropagation()">
  <div class="modal-header">
    <div class="modal-title">🧠 Hybrid RAG Configuration</div>
    <button class="modal-close" (click)="close()">✕</button>
  </div>

  <!-- RAG mode -->
  <div class="modal-section">
    <div class="modal-section-title">Retrieval Mode</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div *ngFor="let m of modes" class="mode-card" [class.sel]="cfg.mode===m.k" (click)="cfg.mode=m.k">
        <div class="mode-card-icon">{{ m.icon }}</div>
        <div class="mode-card-title">{{ m.label }}</div>
        <div class="mode-card-desc">{{ m.desc }}</div>
      </div>
    </div>
  </div>

  <!-- RAG params -->
  <div class="modal-section">
    <div class="modal-section-title">Parameters</div>
    <div class="cfg-row">
      <span class="cfg-lbl">Top-K chunks</span>
      <span class="cfg-val">{{ cfg.topK }}</span>
      <input class="cfg-slider" type="range" [(ngModel)]="cfg.topK" min="1" max="10" step="1">
    </div>
    <div class="cfg-row">
      <span class="cfg-lbl">Chunk size (chars)</span>
      <span class="cfg-val">{{ cfg.chunkSize }}</span>
      <input class="cfg-slider" type="range" [(ngModel)]="cfg.chunkSize" min="150" max="800" step="50">
    </div>
    <div class="cfg-row">
      <span class="cfg-lbl">Overlap (chars)</span>
      <span class="cfg-val">{{ cfg.overlap }}</span>
      <input class="cfg-slider" type="range" [(ngModel)]="cfg.overlap" min="0" max="150" step="10">
    </div>
    <div class="cfg-row">
      <span class="cfg-lbl">Min score threshold</span>
      <span class="cfg-val">{{ cfg.minScore.toFixed(2) }}</span>
      <input class="cfg-slider" type="range" [(ngModel)]="cfg.minScore" min="0.01" max="0.5" step="0.01">
    </div>
  </div>

  <!-- Stats -->
  <div class="modal-section" *ngIf="rag.totalChunks > 0">
    <div class="modal-section-title">Current Index</div>
    <div class="rag-stats-grid">
      <div class="rag-stat-card">
        <div class="rag-stat-val">{{ rag.totalChunks }}</div>
        <div class="rag-stat-lbl">Total Chunks</div>
      </div>
      <div class="rag-stat-card">
        <div class="rag-stat-val" [style.color]="rag.indexedChunks>0?'var(--green)':'var(--dim)'">
          {{ rag.indexedChunks }}
        </div>
        <div class="rag-stat-lbl">Dense Vectors</div>
      </div>
    </div>
    <div class="embed-progress" *ngIf="embedSvc.status()==='loading'" style="margin-top:8px">
      <div class="embed-spinner"></div>
      <span>Building dense index {{ embedSvc.progress() }}%</span>
    </div>
    <div style="margin-top:8px" *ngIf="embedSvc.status()==='error'">
      <span style="font-size:11px;color:var(--amber)">⚠️ Dense embeddings unavailable — using BM25 sparse only.
        Internet access required to load all-MiniLM-L6-v2 model.</span>
    </div>
  </div>

  <div class="btn-row">
    <button class="btn-p" (click)="save()">✓ Apply & Re-index</button>
    <button class="btn-s" (click)="reindex()">🔄 Re-index Now</button>
    <button class="btn-s" (click)="close()">Cancel</button>
  </div>
</div>
</div>
  `,
  styles: [`
    .mode-card{padding:10px;border:1px solid var(--border);border-radius:10px;cursor:pointer;transition:.2s;
      &:hover{border-color:var(--border-a)} &.sel{border-color:var(--blue);background:rgba(59,130,246,.08)}}
    .mode-card-icon{font-size:18px;margin-bottom:4px}
    .mode-card-title{font-size:12px;font-weight:600;color:var(--text)}
    .mode-card-desc{font-size:10px;color:var(--muted);margin-top:2px}
  `]
})
export class RagConfigModalComponent {
  cfg: RagConfig;
  modes: {k:RagMode;icon:string;label:string;desc:string}[] = [
    {k:'hybrid',icon:'🔀',label:'Hybrid (RRF)',desc:'Dense + Sparse fused via Reciprocal Rank Fusion'},
    {k:'dense', icon:'🔵',label:'Dense Only',  desc:'Semantic similarity with MiniLM embeddings'},
    {k:'sparse',icon:'🟡',label:'Sparse Only', desc:'BM25 keyword matching — no model required'},
    {k:'off',   icon:'⭕',label:'Off',          desc:'Disable RAG — use sector context only'},
  ];

  constructor(
    public st: StateService,
    public rag: RagService,
    public embedSvc: EmbeddingService,
    private au: AuditService,
    private corpus: CorpusAggregatorService,
  ) {
    this.cfg = { ...st.ragConfig() };
  }

  save() {
    this.st.ragConfig.set({ ...this.cfg });
    this.au.log('RAG Config Updated', `mode=${this.cfg.mode}, topK=${this.cfg.topK}`, 'internal');
    this.reindex();
    this.close();
  }

  async reindex() {
    await this.corpus.reindexFullCorpus();
    this.au.log('RAG Re-indexed', `${this.rag.totalChunks} chunks (full corpus)`, 'internal');
  }

  close() { this.st.activeModal.set(null); }
}
