import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, combineLatest, debounceTime, skip, takeUntil } from 'rxjs';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { ApiService } from '../../services/api.service';
import { AskNoraBootstrapService } from '../../services/ask-nora-bootstrap.service';
import { HeaderComponent } from '../../components/header/header.component';
import { SectorPanelComponent } from '../../components/sector-panel/sector-panel.component';
import { ChatPanelComponent } from '../../components/chat-panel/chat-panel.component';
import { InfoPanelComponent } from '../../components/info-panel/info-panel.component';
import { ApiConfigModalComponent } from '../../components/modals/api-config/api-config-modal.component';
import { PortabilityModalComponent } from '../../components/modals/portability/portability-modal.component';
import { RagConfigModalComponent } from '../../components/modals/rag-config/rag-config-modal.component';

/** Ask Nora — Hybrid RAG enterprise assistant (original full workspace UI). */
@Component({
  selector: 'app-ask-nora-page',
  standalone: true,
  imports: [
    CommonModule,
    HeaderComponent,
    SectorPanelComponent,
    ChatPanelComponent,
    InfoPanelComponent,
    ApiConfigModalComponent,
    PortabilityModalComponent,
    RagConfigModalComponent,
  ],
  template: `
    <app-header />
    <div class="layout">
      <app-sector-panel />
      <app-chat-panel />
      <app-info-panel />
    </div>
    <app-api-config-modal *ngIf="st.activeModal() === 'api'" />
    <app-portability-modal *ngIf="st.activeModal() === 'portability'" />
    <app-rag-config-modal *ngIf="st.activeModal() === 'rag-config'" />
    <div class="save-toast" *ngIf="toast">
      <div style="width:6px;height:6px;background:var(--green);border-radius:50%"></div>
      Saved to local storage
    </div>
  `,
  styles: [
    `:host{display:block;height:100vh;overflow:hidden}
    :host-context(.both-shell){height:100%;min-height:0}
    .layout{display:grid;grid-template-columns:268px 1fr 256px;height:calc(100vh - 62px)}
    :host-context(.both-shell) .layout{height:calc(100% - 62px)}`,
  ],
})
export class AskNoraPageComponent implements OnInit, OnDestroy {
  toast = false;
  private _t: ReturnType<typeof setTimeout> | undefined;
  private _d$ = new Subject<void>();

  constructor(
    public st: StateService,
    private ss: StorageService,
    private api: ApiService,
    private bootstrap: AskNoraBootstrapService,
  ) {}

  ngOnInit(): void {
    this.bootstrap.restoreOnce(this.st, this.ss);
    this.ss.refresh();

    combineLatest([this.st.messages$, this.st.docs$])
      .pipe(debounceTime(500), skip(1), takeUntil(this._d$))
      .subscribe(() => this._save());

    this.api.checkHealth().then(() => this.st.hybridMode.set(this.api.hybridMode));
    setInterval(() => {
      this.api.lastChecked = 0;
      this.api.checkHealth().then(() => this.st.hybridMode.set(this.api.hybridMode));
    }, 60_000);
    setInterval(() => this.ss.refresh(), 30_000);
  }

  ngOnDestroy(): void {
    this._d$.next();
    this._d$.complete();
  }

  private _save(): void {
    this.ss.persist({
      sector: this.st.sector(),
      role: this.st.role(),
      sensitivity: this.st.sensitivity(),
      useRag: this.st.useRag(),
      ragConfig: this.st.ragConfig(),
      msgCount: this.st.msgCount(),
      messages: this.st.messages,
      docs: this.st.docs,
      audits: this.st.auditEntries,
      api: this.st.api,
    });
    if (this._t) {
      clearTimeout(this._t);
    }
    this.toast = true;
    this._t = setTimeout(() => (this.toast = false), 2000);
  }

}
