import { Component, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule }  from '@angular/forms';
import { StateService } from '../../services/state.service';
import { ApiService, PROV_COLOR, PROV_LABEL } from '../../services/api.service';
import { StorageService } from '../../services/storage.service';
import { AuditService }   from '../../services/audit.service';
import { RagService }     from '../../services/rag.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
<header class="hdr">
  <div class="logo-area">
    <div class="logo-badge">N</div>
    <div>
      <div class="logo-text"><span>CSI</span> Nora <span class="ver">v4</span></div>
      <div class="logo-sub">Singtel Enterprise Portfolio Advisor · Hybrid RAG</div>
    </div>
  </div>

  <div class="hdr-right">
    <div class="security-badge"><div class="dot"></div>Secure Session</div>

    <!-- Hybrid mode badge -->
    <div class="mode-badge" [ngClass]="modeCls()">
      <div class="mode-dot" [ngClass]="modeDot()"></div>
      {{ modeLabel() }}
    </div>

    <!-- RAG badge -->
    <div class="rag-badge" [class.active]="st.useRag() && rag.hasIndex" (click)="st.activeModal.set('rag-config')"
         title="Open RAG Configuration">
      🧠 RAG
      <span class="rag-badge-count" *ngIf="rag.totalChunks > 0">{{ rag.totalChunks }}</span>
    </div>

    <!-- Provider badge -->
    <button class="prov-badge" (click)="st.activeModal.set('api')">
      <div class="prov-dot" [style.background]="api.provColor"></div>
      <span>{{ api.provLabel }}</span>
      <span class="model-lbl">{{ api.shortModel(st.api.provider) }}</span>
      ⚙️
    </button>

    <!-- Role -->
    <div class="role-sel">
      👤
      <select [(ngModel)]="role">
        <option *ngFor="let r of roles" [value]="r">{{ r | titlecase }}</option>
      </select>
    </div>

    <button class="hdr-btn" (click)="st.activeModal.set('portability')">📦 Export</button>
    <button class="hdr-btn danger" (click)="clearAll()">🗑 Clear</button>
  </div>
</header>
  `,
  styles: [`
    .hdr{display:flex;align-items:center;justify-content:space-between;padding:12px 24px;
      background:rgba(10,10,15,.97);border-bottom:1px solid var(--border);
      position:sticky;top:0;z-index:200;backdrop-filter:blur(12px);gap:12px;height:62px}
    .logo-area{display:flex;align-items:center;gap:12px;flex-shrink:0}
    .logo-badge{width:36px;height:36px;background:linear-gradient(135deg,var(--red),var(--red-deep));
      border-radius:10px;display:flex;align-items:center;justify-content:center;
      font-family:var(--fd);font-weight:800;font-size:15px;color:#fff;box-shadow:0 0 20px var(--red-glow)}
    .logo-text{font-family:var(--fd);font-weight:700;font-size:17px span{color:var(--red)}}
    .logo-text span{color:var(--red)} .ver{font-size:11px;color:var(--dim);font-weight:400}
    .logo-sub{font-size:9px;color:var(--dim);margin-top:1px}
    .hdr-right{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
    .security-badge{display:flex;align-items:center;gap:6px;padding:5px 10px;
      background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.2);border-radius:20px;
      font-size:11px;color:var(--green);white-space:nowrap}
    .dot{width:6px;height:6px;background:var(--green);border-radius:50%;animation:pulse-g 2s infinite}
    .rag-badge{display:flex;align-items:center;gap:4px;padding:5px 9px;background:var(--card);
      border:1px solid var(--border);border-radius:8px;font-size:11px;color:var(--muted);cursor:pointer;transition:.2s;
      &:hover,&.active{border-color:rgba(59,130,246,.4);color:var(--blue);background:rgba(59,130,246,.08)}}
    .rag-badge-count{background:var(--blue);color:#fff;border-radius:10px;
      padding:0 5px;font-size:9px;font-weight:600}
    .prov-badge{display:flex;align-items:center;gap:5px;padding:5px 9px;background:var(--card);
      border:1px solid var(--border);border-radius:8px;font-size:11px;cursor:pointer;transition:.2s;
      color:var(--text);&:hover{border-color:var(--border-a)}}
    .prov-dot{width:7px;height:7px;border-radius:50%}
    .model-lbl{color:var(--dim);font-size:10px}
    .role-sel{display:flex;align-items:center;gap:5px;padding:5px 9px;background:var(--card);
      border:1px solid var(--border);border-radius:8px;font-size:12px;color:var(--muted)
      select{background:transparent;border:none;color:var(--text);font-family:var(--fb);font-size:12px;cursor:pointer;outline:none;
        option{background:var(--card)}}}
    .role-sel select{background:transparent;border:none;color:var(--text);font-family:var(--fb);
      font-size:12px;cursor:pointer;outline:none;option{background:var(--card)}}
    .hdr-btn{padding:5px 9px;border-radius:8px;border:1px solid var(--border);background:var(--card);
      color:var(--muted);font-size:11px;cursor:pointer;transition:.15s;white-space:nowrap;font-family:var(--fb);
      &:hover{border-color:var(--border-a);color:var(--text)} &.danger:hover{border-color:rgba(224,0,26,.5);color:var(--red)}}
  `]
})
export class HeaderComponent {
  roles = ['engineer','support','sales','manager','executive'];
  constructor(public st: StateService, public api: ApiService,
              private ss: StorageService, private au: AuditService, public rag: RagService) {}

  get role() { return this.st.role(); }
  set role(v: any) { this.st.role.set(v); this.au.log('Role Changed', v, 'internal'); }

  modeCls()   { const m = this.st.hybridMode(); return m === 'hybrid' ? 'm-hybrid' : m === 'local' ? 'm-local' : 'm-checking'; }
  modeDot()   { const m = this.st.hybridMode(); return m === 'hybrid' ? 'md-hybrid' : m === 'local' ? 'md-local' : 'md-checking'; }
  modeLabel() { const m = this.st.hybridMode(); return m === 'hybrid' ? '🟢 Hybrid RAG' : m === 'local' ? '🟡 Local Mode' : '🔄 Checking…'; }

  clearAll() {
    if (!confirm('Clear all messages and documents?')) return;
    this.st.clearMessages(); this.st.setDocs([]);
    this.ss.clearPartial('all'); this.rag.clearAll();
    this.au.log('Session Cleared', 'All data removed', 'internal');
  }
}
