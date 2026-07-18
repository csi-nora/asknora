import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { StateService }  from '../../../services/state.service';
import { StorageService } from '../../../services/storage.service';
import { AuditService }  from '../../../services/audit.service';
import { ApiService, PROV_LABEL } from '../../../services/api.service';
import { RagService }    from '../../../services/rag.service';
import { KbStorageService } from '../../../services/kb-storage.service';
import { NamedSession }  from '../../../models';
import { SECTORS }       from '../../../data/sectors.data';

@Component({
  selector: 'app-portability-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<div class="modal-overlay" (click)="close()">
<div class="modal" (click)="$event.stopPropagation()">
  <div class="modal-header">
    <div class="modal-title">📦 Export & Import</div>
    <button class="modal-close" (click)="close()">✕</button>
  </div>

  <!-- Export -->
  <div class="modal-section">
    <div class="modal-section-title">Export</div>
    <div class="export-grid">
      <div class="export-card" (click)="exportJson()">
        <div class="export-card-icon">📄</div>
        <div class="export-card-title">Chat as JSON</div>
        <div class="export-card-desc">Full session + metadata</div>
      </div>
      <div class="export-card" (click)="exportMarkdown()">
        <div class="export-card-icon">📝</div>
        <div class="export-card-title">Chat as Markdown</div>
        <div class="export-card-desc">Readable transcript</div>
      </div>
      <div class="export-card" (click)="exportKb()">
        <div class="export-card-icon">🗃️</div>
        <div class="export-card-title">Knowledge Base</div>
        <div class="export-card-desc">All ingested docs</div>
      </div>
      <div class="export-card" (click)="au.downloadCsv()">
        <div class="export-card-icon">🧾</div>
        <div class="export-card-title">Audit Log CSV</div>
        <div class="export-card-desc">Compliance export</div>
      </div>
    </div>
  </div>

  <!-- Import -->
  <div class="modal-section">
    <div class="modal-section-title">Import Session</div>
    <p style="font-size:12px;color:var(--muted);margin-bottom:10px">Restore a previously exported JSON session.</p>
    <div class="btn-row">
      <button class="btn-p" (click)="importInput.click()">📂 Choose File</button>
      <input #importInput type="file" accept=".json" hidden (change)="onImport($event)">
    </div>
  </div>

  <!-- Named Sessions -->
  <div class="modal-section">
    <div class="modal-section-title">💾 Named Sessions</div>
    <div style="display:flex;gap:6px;margin-bottom:8px">
      <input class="fi" [(ngModel)]="name" placeholder="Session name…" style="flex:1;font-size:12px">
      <button class="btn-p" (click)="saveSession()" style="padding:9px 12px;font-size:12px">Save</button>
    </div>
    <div class="ns-list">
      <div class="no-items" *ngIf="!sessions().length">No saved sessions</div>
      <div class="ns-item" *ngFor="let s of sessions(); trackBy: trackId">
        <span style="font-size:14px">{{ sIcon(s.sector) }}</span>
        <div style="flex:1;min-width:0">
          <div class="ns-name">{{ s.name }}</div>
          <div class="ns-meta">{{ s.msgCount }} msg · {{ s.sector||'—' }} · {{ s.savedAt | date:'shortDate' }}</div>
        </div>
        <button class="ns-load" (click)="loadSession(s)">↩ Load</button>
        <button class="ns-del" (click)="delSession(s.id)">✕</button>
      </div>
    </div>
  </div>

  <!-- Storage manager -->
  <div class="modal-section">
    <div class="modal-section-title">🗃 Storage Manager</div>
    <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">
      <span style="color:var(--muted)">Total</span>
      <span style="font-weight:600">{{ ss.fmt(ss.stats$.value.total) }} / 5 MB</span>
    </div>
    <div class="storage-bar-wrap" style="height:7px">
      <div class="storage-bar" [ngClass]="barCls()" [style.width.%]="ss.stats$.value.pct"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;margin-top:6px">
      <span style="color:var(--muted)">KB backing store</span>
      <span [style.color]="kb.overflow() ? 'var(--green)' : 'var(--dim)'">
        {{ kb.overflow() ? '💾 IndexedDB (overflow' + (kb.persisted() ? ', pinned)' : ')') : 'localStorage (fast path)' }}
      </span>
    </div>
    <div class="stor-clear-row" style="margin-top:8px">
      <button class="stor-clear-btn" (click)="clear('messages')">Messages</button>
      <button class="stor-clear-btn" (click)="clear('docs')">Docs</button>
      <button class="stor-clear-btn" (click)="clear('vectors')">Vectors</button>
      <button class="stor-clear-btn" (click)="clear('named')">Sessions</button>
      <button class="stor-clear-btn danger" (click)="clear('all')">⚠ All</button>
    </div>
  </div>

</div>
</div>
  `
})
export class PortabilityModalComponent implements OnInit {
  name = '';
  sessions = signal<NamedSession[]>([]);

  constructor(
    public st: StateService,
    public ss: StorageService,
    public au: AuditService,
    private apiSvc: ApiService,
    private rag: RagService,
    public kb: KbStorageService,
  ) {}

  ngOnInit() { this.sessions.set(this.ss.getSessions()); this.ss.refresh(); }

  // ── Export ───────────────────────────────────────────────
  exportJson() {
    const data = {
      version:'csinora-v4',exportedAt:new Date().toISOString(),
      session:{sector:this.st.sector(),role:this.st.role(),provider:this.st.api.provider},
      messages:this.st.messages,
      documents:this.st.docs.map(d=>({id:d.id,name:d.name,type:d.type,size:d.size,sensitivity:d.sensitivity})),
      audit:this.st.auditEntries,
    };
    this._dl('csinora-session-'+Date.now()+'.json',JSON.stringify(data,null,2),'application/json');
    this.au.log('Export','Chat as JSON',this.st.sensitivity());
  }
  exportMarkdown() {
    const s = this.st.sector() ? SECTORS[this.st.sector()!] : null;
    let md = `# CSI Nora — Chat Transcript\n\n**Sector:** ${s?.name||'—'} | **Provider:** ${PROV_LABEL[this.st.api.provider]}\n\n**Exported:** ${new Date().toLocaleString()}\n\n---\n\n`;
    for (const m of this.st.messages) {
      md += `${m.role==='nora'?'**Nora**':'**User**'}\n\n${m.content}\n\n---\n\n`;
    }
    this._dl('csinora-transcript-'+Date.now()+'.md',md,'text/markdown');
  }
  exportKb() {
    const data = {version:'csinora-kb-v4',documents:this.st.docs.map(d=>({name:d.name,type:d.type,content:d.content,sensitivity:d.sensitivity}))};
    this._dl('csinora-kb-'+Date.now()+'.json',JSON.stringify(data,null,2),'application/json');
  }

  // ── Import ───────────────────────────────────────────────
  onImport(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = ev => {
      try {
        const d = JSON.parse((ev.target as FileReader).result as string);
        if (!d.version?.startsWith('csinora')) throw new Error('Invalid file');
        if (d.session?.sector && SECTORS[d.session.sector]) this.st.sector.set(d.session.sector);
        if (d.session?.role)   this.st.role.set(d.session.role);
        if (d.messages?.length) this.st.setMessages(d.messages);
        this.au.log('Session Imported', f.name, 'internal');
        this.close();
      } catch (err) { alert('Import failed: ' + (err as Error).message); }
    };
    r.readAsText(f);
    (e.target as HTMLInputElement).value = '';
  }

  // ── Named Sessions ───────────────────────────────────────
  saveSession() {
    if (!this.name.trim()) return;
    this.ss.saveSession({ name:this.name.trim(), sector:this.st.sector(), role:this.st.role(),
      msgCount:this.st.messages.length, messages:this.st.messages, docs:this.st.docs });
    this.name = '';
    this.sessions.set(this.ss.getSessions());
    this.au.log('Session Saved', this.name, this.st.sensitivity());
  }
  loadSession(s: NamedSession) {
    if (s.sector && SECTORS[s.sector]) this.st.sector.set(s.sector);
    this.st.role.set(s.role);
    if (s.messages?.length) this.st.setMessages(s.messages);
    if (s.docs?.length) this.st.setDocs(s.docs);
    this.au.log('Session Loaded', s.name, this.st.sensitivity());
    this.close();
  }
  delSession(id: string) { this.ss.deleteSession(id); this.sessions.set(this.ss.getSessions()); }

  sIcon(k: string|null) { return k ? (SECTORS[k]?.icon || '💼') : '💼'; }

  clear(t: any) {
    if (!confirm(`Clear ${t}?`)) return;
    this.ss.clearPartial(t);
    if (t==='vectors'||t==='all') this.rag.clearAll();
    if (t==='messages'||t==='all') this.st.clearMessages();
    if (t==='docs'    ||t==='all') this.st.setDocs([]);
    if (t==='named'   ||t==='all') this.sessions.set([]);
  }

  barCls() { const p=this.ss.stats$.value.pct; return p<70?'s-ok':p<90?'s-warn':'s-full'; }

  private _dl(name: string, content: string, type: string) {
    const a = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([content],{type})),download:name});
    a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }

  close() { this.st.activeModal.set(null); }
  trackId = (_: number, s: NamedSession) => s.id;
}
