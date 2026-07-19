import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule }   from '@angular/common';
import { Subject, combineLatest, debounceTime, skip, takeUntil } from 'rxjs';
import { StateService }   from './services/state.service';
import { StorageService } from './services/storage.service';
import { AuditService }   from './services/audit.service';
import { ApiService }     from './services/api.service';
import { RagService }     from './services/rag.service';
import { KbStorageService } from './services/kb-storage.service';
import { KbBackendService } from './services/kb-backend.service';
import { SECTORS }        from './data/sectors.data';
import { HeaderComponent }      from './components/header/header.component';
import { SectorPanelComponent } from './components/sector-panel/sector-panel.component';
import { ChatPanelComponent }   from './components/chat-panel/chat-panel.component';
import { InfoPanelComponent }   from './components/info-panel/info-panel.component';
import { ApiConfigModalComponent }  from './components/modals/api-config/api-config-modal.component';
import { PortabilityModalComponent } from './components/modals/portability/portability-modal.component';
import { RagConfigModalComponent }   from './components/modals/rag-config/rag-config-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent, SectorPanelComponent, ChatPanelComponent, InfoPanelComponent,
    ApiConfigModalComponent, PortabilityModalComponent, RagConfigModalComponent,
  ],
  template: `
    <app-header />
    <div class="layout">
      <app-sector-panel />
      <app-chat-panel />
      <app-info-panel />
    </div>
    <app-api-config-modal   *ngIf="st.activeModal() === 'api'" />
    <app-portability-modal  *ngIf="st.activeModal() === 'portability'" />
    <app-rag-config-modal   *ngIf="st.activeModal() === 'rag-config'" />
    <div class="save-toast" *ngIf="toast">
      <div style="width:6px;height:6px;background:var(--green);border-radius:50%"></div>
      Saved to local storage
    </div>
  `,
  styles: [`:host{display:block;height:100vh;overflow:hidden}
    .layout{display:grid;grid-template-columns:268px 1fr 256px;height:calc(100vh - 62px)}`]
})
export class AppComponent implements OnInit, OnDestroy {
  toast = false;
  private _t: any;
  private _d$ = new Subject<void>();

  constructor(
    public  st:  StateService,
    private ss:  StorageService,
    private au:  AuditService,
    private api: ApiService,
    private rag: RagService,
    private kb:  KbStorageService,
    private kbBackend: KbBackendService,
  ) {}

  ngOnInit() {
    this.ss.loadPrefs();
    this._restore();
    this.ss.refresh();

    // If the KB overflowed to the persistent store, doc content lives in
    // IndexedDB — merge it back once the tier is known (non-blocking).
    this.kb.init().then(async () => {
      if (this.kb.overflow() && this.st.docs.length) {
        this.st.setDocs(await this.ss.rehydrateDocs(this.st.docs));
      }
    });

    // Detect the disk-backed server KB (bridge reachable) vs browser fallback.
    // Server mode: the KB lives on the host (Qdrant + Postgres), shared across
    // browsers/devices and surviving restarts — so the doc list is loaded FROM
    // the server (source of truth). Browser mode (e.g. static GitHub Pages demo,
    // or bridge down): fall back to the local store and restore dense vectors.
    this.kbBackend.probe().then(async isServer => {
      if (isServer) {
        try {
          const docs = await this.kbBackend.listDocs();
          this.st.setDocs(docs);
        } catch (e) { console.warn('[KB] server list failed; keeping local docs', e); }
        this.kbBackend.refreshStats();
        this.rag.preloadEmbedder();   // warm the embedder for fast first query
      } else {
        // Load the self-hosted embedding model at startup when persisted dense
        // vectors exist, so retrieval stays DENSE after a browser restart (docs keep
        // "dense + BM25", not "BM25 only") without any manual re-index. Non-blocking.
        this.rag.ready().then(() => this.rag.warmUpEmbeddings());
      }
    });

    // Auto-save on any message/doc change
    combineLatest([this.st.messages$, this.st.docs$])
      .pipe(debounceTime(500), skip(1), takeUntil(this._d$))
      .subscribe(() => this._save());

    // Health check + periodic recheck
    this.api.checkHealth().then(() => this.st.hybridMode.set(this.api.hybridMode));
    setInterval(() => {
      this.api.lastChecked = 0;
      this.api.checkHealth().then(() => this.st.hybridMode.set(this.api.hybridMode));
    }, 60_000);
    setInterval(() => this.ss.refresh(), 30_000);
  }

  ngOnDestroy() { this._d$.next(); this._d$.complete(); }

  private _save() {
    this.ss.persist({
      sector:    this.st.sector(), role: this.st.role(),
      sensitivity: this.st.sensitivity(), useRag: this.st.useRag(),
      ragConfig: this.st.ragConfig(), msgCount: this.st.msgCount(),
      messages: this.st.messages, docs: this.st.docs,
      audits:   this.st.auditEntries, api: this.st.api,
    });
    clearTimeout(this._t);
    this.toast = true;
    this._t = setTimeout(() => this.toast = false, 2000);
  }

  private _restore() {
    // API config — merge so older localStorage still gets ollama defaults
    const cfg = this.ss.loadApiCfg();
    if (cfg && Object.keys(cfg).length) {
      this.st.patchApi({
        ...cfg,
        models:    { ...this.st.api.models, ...(cfg.models || {}) },
        keys:      { ...this.st.api.keys, ...(cfg.keys || {}) },
        maxTokens: { ...this.st.api.maxTokens, ...(cfg.maxTokens || {}) },
        baseUrls:  { ...this.st.api.baseUrls, ...(cfg.baseUrls || {}) },
      } as any);
    }
    if (this.ss.rememberKeys$.value) {
      const keys = this.ss.loadApiKeys();
      if (keys && Object.keys(keys).length) this.st.patchApi({ keys: { ...this.st.api.keys, ...keys } as any });
    }
    // Docs
    const docs = this.ss.loadDocs();
    if (docs.length) {
      this.st.setDocs(docs);
      // Re-index from persisted chunks (already in localStorage via RAG service)
    }
    // Audit
    const audit = this.ss.loadAudit();
    if (audit.length) this.st.setAudits(audit);
    // Session
    const sess = this.ss.loadSession();
    if (sess) {
      if (sess.role)      this.st.role.set(sess.role);
      if (sess.sensitivity) this.st.sensitivity.set(sess.sensitivity);
      if (sess.useRag != null) this.st.useRag.set(sess.useRag);
      if (sess.ragConfig) {
        // Migrate stale configs: minScore applies to RRF fused scores (top hit
        // ≈0.033). Any value above the new 0.02 cap silently suppressed all
        // citations, so clamp it back to the safe default.
        const rc = { ...sess.ragConfig };
        if (rc.minScore == null || rc.minScore > 0.02) rc.minScore = 0.01;
        this.st.ragConfig.set(rc);
      }
      if (sess.sector && SECTORS[sess.sector]) this.st.sector.set(sess.sector);
      if (sess.messages?.length) this.st.setMessages(sess.messages);
    }
  }
}
