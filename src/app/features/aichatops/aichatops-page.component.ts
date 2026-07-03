import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { StateService } from '../../services/state.service';
import {
  AIChatOpsAgentService,
  AIChatOpsPlaybook,
  AIChatOpsRun,
  AIChatOpsStep,
  AIChatOpsTool,
} from './aichatops-agent.service';

interface TranscriptEntry {
  kind: 'user' | 'agent';
  text?: string;
  run?: AIChatOpsRun;
  at: string;
}

/**
 * CSI Nora · AIChatOps Interface
 *
 * Agentic AI workspace for chat-ops: plans multi-step actions, invokes a typed
 * tool registry, pauses on destructive steps for human approval, and writes
 * an audit trail. UI is a self-contained 3-column workspace built with inline
 * template + styles so it lives alongside the existing Ask Nora / Governance
 * experiences without touching their shared components.
 */
@Component({
  selector: 'app-aichatops-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="aco-shell">
  <!-- ── Top bar ───────────────────────────────────────────── -->
  <header class="aco-top">
    <a routerLink="/" class="aco-back" aria-label="Back to launcher">← Launcher</a>
    <div class="aco-brand">
      <div class="aco-logo">N</div>
      <div class="aco-titlewrap">
        <h1>
          <span class="aco-csi">CSI</span> Nora ·
          <span class="aco-aco">AIChatOps</span>
        </h1>
        <p class="aco-sub">Agentic AI for Singtel CSI chat-driven operations</p>
      </div>
    </div>

    <div class="aco-status">
      <span class="aco-pill" [class.aco-pill-on]="busy()" [class.aco-pill-warn]="awaitingApproval()">
        <span class="aco-dot"></span>
        {{ statusLabel() }}
      </span>
      <span class="aco-pill aco-pill-quiet" [title]="'LLM polish mode for the most recent run'">
        LLM: {{ llmModeLabel() }}
      </span>
    </div>
  </header>

  <!-- ── Body grid ─────────────────────────────────────────── -->
  <div class="aco-grid">
    <!-- ── Left rail ─ playbooks + tool registry ── -->
    <aside class="aco-rail aco-rail-l">
      <div class="aco-section">
        <h2 class="aco-h2">Playbooks</h2>
        <p class="aco-h2-sub">Click a playbook to seed the agent.</p>
        <ul class="aco-pb-list">
          <li *ngFor="let pb of agent.playbooks" class="aco-pb-item">
            <button type="button" class="aco-pb-btn" (click)="seedPlaybook(pb)">
              <span class="aco-pb-ic">{{ pb.icon }}</span>
              <span class="aco-pb-body">
                <span class="aco-pb-name">{{ pb.name }}</span>
                <span class="aco-pb-desc">{{ pb.description }}</span>
              </span>
            </button>
          </li>
        </ul>
      </div>

      <div class="aco-section">
        <h2 class="aco-h2">Tool registry</h2>
        <p class="aco-h2-sub">Typed tools the agent may invoke.</p>
        <ul class="aco-tools">
          <li *ngFor="let t of agent.tools" class="aco-tool">
            <div class="aco-tool-row">
              <code class="aco-tool-name">{{ t.name }}</code>
              <span class="aco-risk" [attr.data-risk]="t.risk">{{ riskLabel(t) }}</span>
            </div>
            <p class="aco-tool-desc">{{ t.description }}</p>
            <button *ngIf="t.slash" type="button" class="aco-tool-slash" (click)="insertSlash(t)" [title]="'Insert ' + t.slash">
              {{ t.slash }}
            </button>
          </li>
        </ul>
      </div>
    </aside>

    <!-- ── Center ─ agent chat transcript ── -->
    <main class="aco-main">
      <section class="aco-stream" #streamEl>
        <div *ngIf="!transcript().length" class="aco-empty">
          <div class="aco-empty-icon">🤖</div>
          <h3>Hello, operator.</h3>
          <p>
            I'm <strong>CSI Nora AIChatOps</strong> — an agentic AI for chat-driven
            operations. Describe what you'd like to do, or use a slash command like
            <code>/status payments-api</code> or <code>/deploy checkout-service</code>.
            Destructive steps will <em>pause for your approval</em>.
          </p>
          <div class="aco-empty-chips">
            <button type="button" class="aco-chip" (click)="runQuick('/status payments-api')">/status payments-api</button>
            <button type="button" class="aco-chip" (click)="runQuick('/incidents')">/incidents</button>
            <button type="button" class="aco-chip" (click)="runQuick('Triage P2 on payments-api')">Triage P2 on payments-api</button>
            <button type="button" class="aco-chip" (click)="runQuick('Cost audit for data-platform')">Cost audit · data-platform</button>
          </div>
        </div>

        <article *ngFor="let entry of transcript(); trackBy: trackEntry" class="aco-msg" [attr.data-kind]="entry.kind">
          <ng-container *ngIf="entry.kind === 'user'">
            <div class="aco-msg-head">
              <span class="aco-avatar aco-avatar-user">You</span>
              <span class="aco-msg-time">{{ entry.at }}</span>
            </div>
            <div class="aco-bubble aco-bubble-user">{{ entry.text }}</div>
          </ng-container>

          <ng-container *ngIf="entry.kind === 'agent' && entry.run as r">
            <div class="aco-msg-head">
              <span class="aco-avatar aco-avatar-agent">N</span>
              <span class="aco-msg-time">{{ formatTime(r.startedAt) }}</span>
              <span class="aco-run-state" [attr.data-state]="r.status">{{ runStateLabel(r) }}</span>
            </div>

            <div class="aco-bubble aco-bubble-agent">
              <div class="aco-plan-line">
                <strong>Plan ({{ r.steps.length }} step{{ r.steps.length === 1 ? '' : 's' }}):</strong>
                {{ planOneLiner(r) }}
              </div>

              <ol class="aco-steps">
                <li *ngFor="let s of r.steps; let i = index" class="aco-step" [attr.data-status]="s.status">
                  <div class="aco-step-head">
                    <span class="aco-step-idx">{{ i + 1 }}</span>
                    <code class="aco-step-tool">{{ s.toolName }}</code>
                    <span class="aco-risk" [attr.data-risk]="s.risk">{{ s.risk }}</span>
                    <span class="aco-step-status" [attr.data-status]="s.status">{{ stepStatusLabel(s) }}</span>
                  </div>
                  <div class="aco-step-intent">{{ s.intent }}</div>

                  <div *ngIf="s.status === 'awaiting-approval'" class="aco-approval">
                    <p class="aco-approval-msg">
                      ⚠️ This step is <strong>{{ s.risk }}</strong> and requires explicit human approval before execution.
                    </p>
                    <div class="aco-approval-actions">
                      <button type="button" class="aco-btn aco-btn-deny" (click)="deny(r, s)">Deny</button>
                      <button type="button" class="aco-btn aco-btn-approve" (click)="approve(r, s)">Approve & continue</button>
                    </div>
                  </div>

                  <div *ngIf="s.output && s.status !== 'awaiting-approval'" class="aco-output">
                    <div class="aco-output-title">{{ s.output }}</div>
                    <pre *ngIf="s.outputLines?.length" class="aco-output-body">{{ formatLines(s.outputLines!) }}</pre>
                  </div>
                </li>
              </ol>

              <div *ngIf="r.finalAnswer" class="aco-final">
                <div class="aco-final-head">
                  <span class="aco-final-tag">Summary</span>
                  <span class="aco-final-mode" [attr.data-mode]="r.llmMode || 'local'">
                    {{ r.llmMode === 'hybrid' ? 'LLM hybrid' : 'local fallback' }}
                  </span>
                </div>
                <pre class="aco-final-body">{{ r.finalAnswer }}</pre>
              </div>
            </div>
          </ng-container>
        </article>
      </section>

      <!-- ── Composer ── -->
      <footer class="aco-composer">
        <div class="aco-composer-hint" *ngIf="!busy()">
          Slash commands: <code>/status</code> <code>/incidents</code> <code>/deploy</code>
          <code>/rollback</code> <code>/policy</code> <code>/cost</code> <code>/kb</code>
        </div>
        <div class="aco-composer-hint aco-composer-busy" *ngIf="busy()">
          Agent is running… you can cancel below.
        </div>
        <div class="aco-composer-row">
          <textarea
            #inputEl
            class="aco-input"
            rows="2"
            placeholder="Describe what you need, or type a slash command (e.g. /deploy payments-api)"
            [(ngModel)]="draft"
            (keydown.enter)="onEnter($event)"
            [disabled]="busy()"
          ></textarea>
          <div class="aco-composer-actions">
            <button
              type="button"
              class="aco-btn aco-btn-ghost"
              (click)="cancelActive()"
              [disabled]="!activeRun() || activeRun()!.status === 'complete' || activeRun()!.status === 'cancelled'"
            >Cancel run</button>
            <button
              type="button"
              class="aco-btn aco-btn-primary"
              (click)="submit()"
              [disabled]="!canSubmit()"
            >{{ busy() ? 'Running…' : 'Run' }}</button>
          </div>
        </div>
      </footer>
    </main>

    <!-- ── Right rail ─ live plan + run history + audit ── -->
    <aside class="aco-rail aco-rail-r">
      <div class="aco-section">
        <h2 class="aco-h2">Live plan</h2>
        <p class="aco-h2-sub">Current or most recent run.</p>
        <div *ngIf="!activeRun()" class="aco-empty-mini">No run yet — submit a request to begin.</div>
        <ol *ngIf="activeRun() as r" class="aco-mini-steps">
          <li *ngFor="let s of r.steps" [attr.data-status]="s.status" class="aco-mini-step">
            <span class="aco-mini-dot"></span>
            <div class="aco-mini-body">
              <code class="aco-mini-tool">{{ s.toolName }}</code>
              <span class="aco-mini-intent">{{ s.intent }}</span>
            </div>
          </li>
        </ol>
      </div>

      <div class="aco-section">
        <h2 class="aco-h2">Run history</h2>
        <p class="aco-h2-sub">Most recent first.</p>
        <div *ngIf="!history().length" class="aco-empty-mini">No completed runs yet.</div>
        <ul class="aco-history">
          <li *ngFor="let h of history()" class="aco-history-item" [attr.data-status]="h.status">
            <div class="aco-history-row">
              <span class="aco-history-state" [attr.data-status]="h.status">{{ runStateLabel(h) }}</span>
              <span class="aco-history-time">{{ formatTime(h.startedAt) }}</span>
            </div>
            <div class="aco-history-q">{{ h.userQuery }}</div>
            <div class="aco-history-meta">{{ historyMeta(h) }}</div>
          </li>
        </ul>
      </div>

      <div class="aco-section">
        <h2 class="aco-h2">Audit trail</h2>
        <p class="aco-h2-sub">Latest 6 entries from CSI Nora audit log.</p>
        <ul *ngIf="recentAudits().length; else noAudit" class="aco-audit">
          <li *ngFor="let a of recentAudits()" class="aco-audit-item">
            <div class="aco-audit-row">
              <code class="aco-audit-action">{{ a.action }}</code>
              <span class="aco-audit-time">{{ a.time }}</span>
            </div>
            <div class="aco-audit-detail">{{ a.detail }}</div>
          </li>
        </ul>
        <ng-template #noAudit>
          <div class="aco-empty-mini">Audit log is empty.</div>
        </ng-template>
      </div>
    </aside>
  </div>
</div>
  `,
  styleUrls: ['./aichatops-page.component.scss'],
})
export class AIChatOpsPageComponent implements OnDestroy, AfterViewChecked {
  protected readonly agent = inject(AIChatOpsAgentService);
  private readonly api = inject(ApiService);
  private readonly state = inject(StateService);
  private readonly cdr = inject(ChangeDetectorRef);

  @ViewChild('streamEl') private streamEl?: ElementRef<HTMLElement>;
  @ViewChild('inputEl')  private inputEl?: ElementRef<HTMLTextAreaElement>;

  draft = '';

  readonly transcript = signal<TranscriptEntry[]>([]);
  readonly activeRun = signal<AIChatOpsRun | null>(null);
  readonly history = signal<AIChatOpsRun[]>([]);

  readonly busy = computed(() => this.agent.busy());
  readonly awaitingApproval = computed(() => this.activeRun()?.status === 'awaiting-approval');
  readonly llmModeLabel = computed(() => {
    const m = this.agent.lastLlmMode();
    if (m === 'hybrid')  { return 'hybrid'; }
    if (m === 'local')   { return 'local fallback'; }
    return 'auto';
  });

  readonly recentAudits = computed(() => this.state.auditEntries.slice(0, 6));

  private sub?: Subscription;
  private shouldScroll = false;
  private auditPollId?: ReturnType<typeof setInterval>;

  constructor() {
    this.sub = this.agent.events$.subscribe(({ run }) => {
      const activeId = this.activeRun()?.id;
      if (activeId === run.id) {
        this.activeRun.set({ ...run });
      } else if (!activeId) {
        this.activeRun.set({ ...run });
      }

      this.transcript.update((list) => list.map((e) =>
        e.kind === 'agent' && e.run?.id === run.id ? { ...e, run: { ...run } } : e
      ));

      if (run.status === 'complete' || run.status === 'cancelled' || run.status === 'error') {
        this.history.update((h) => {
          const filtered = h.filter((x) => x.id !== run.id);
          return [{ ...run }, ...filtered].slice(0, 12);
        });
      }

      this.shouldScroll = true;
      this.cdr.markForCheck();
    });

    this.auditPollId = setInterval(() => this.cdr.markForCheck(), 3000);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    if (this.auditPollId) {
      clearInterval(this.auditPollId);
    }
  }

  ngAfterViewChecked(): void {
    if (this.shouldScroll && this.streamEl?.nativeElement) {
      const el = this.streamEl.nativeElement;
      el.scrollTop = el.scrollHeight;
      this.shouldScroll = false;
    }
  }

  canSubmit(): boolean {
    return !this.busy() && this.draft.trim().length > 0;
  }

  onEnter(event: Event): void {
    const ke = event as KeyboardEvent;
    if (ke.shiftKey) {
      return;
    }
    ke.preventDefault();
    this.submit();
  }

  async submit(): Promise<void> {
    const text = this.draft.trim();
    if (!text || this.busy()) {
      return;
    }
    this.draft = '';
    await this.startRun(text);
  }

  runQuick(text: string): void {
    if (this.busy()) {
      return;
    }
    void this.startRun(text);
  }

  seedPlaybook(pb: AIChatOpsPlaybook): void {
    this.draft = pb.prompt;
    setTimeout(() => this.inputEl?.nativeElement.focus(), 0);
  }

  insertSlash(t: AIChatOpsTool): void {
    if (!t.slash) {
      return;
    }
    const cur = this.draft.trim();
    this.draft = cur ? `${t.slash} ${cur}` : `${t.slash} `;
    setTimeout(() => this.inputEl?.nativeElement.focus(), 0);
  }

  async approve(run: AIChatOpsRun, step: AIChatOpsStep): Promise<void> {
    await this.agent.approve(run, step.id);
  }

  deny(run: AIChatOpsRun, step: AIChatOpsStep): void {
    this.agent.deny(run, step.id);
  }

  cancelActive(): void {
    const r = this.activeRun();
    if (r) {
      this.agent.cancel(r);
    }
  }

  // ── presenters ──────────────────────────────────────────────

  trackEntry = (_i: number, e: TranscriptEntry): string =>
    e.kind === 'user' ? 'u-' + _i + '-' + e.at : 'a-' + (e.run?.id ?? _i);

  riskLabel(t: AIChatOpsTool): string {
    if (t.risk === 'destructive') { return 'destructive'; }
    if (t.risk === 'review')      { return 'review'; }
    return 'safe';
  }

  stepStatusLabel(s: AIChatOpsStep): string {
    switch (s.status) {
      case 'awaiting-approval': return 'approval';
      case 'pending':           return 'queued';
      default:                  return s.status;
    }
  }

  runStateLabel(r: AIChatOpsRun): string {
    switch (r.status) {
      case 'planning':          return 'planning';
      case 'running':           return 'running';
      case 'awaiting-approval': return 'awaiting approval';
      case 'awaiting-llm':      return 'summarising';
      case 'complete':          return 'complete';
      case 'cancelled':         return 'cancelled';
      case 'error':             return 'error';
    }
  }

  statusLabel(): string {
    if (this.awaitingApproval()) { return 'Awaiting human approval'; }
    if (this.busy())             { return 'Agent running'; }
    return 'Idle';
  }

  planOneLiner(r: AIChatOpsRun): string {
    return r.steps.map((s) => s.toolName).join(' → ');
  }

  historyMeta(r: AIChatOpsRun): string {
    const dur = r.finishedAt && r.startedAt
      ? Math.max(0, Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 100) / 10) + 's'
      : '—';
    return `${r.steps.length} step${r.steps.length === 1 ? '' : 's'} · ${dur}`;
  }

  formatTime(iso: string | undefined): string {
    if (!iso) { return ''; }
    try {
      return new Date(iso).toLocaleTimeString();
    } catch {
      return iso;
    }
  }

  formatLines(lines: string[]): string {
    return lines.join('\n');
  }

  // ── internal ────────────────────────────────────────────────

  private async startRun(text: string): Promise<void> {
    const at = new Date().toLocaleTimeString();
    this.transcript.update((list) => [...list, { kind: 'user', text, at }]);

    const run = await this.agent.start(text);
    this.activeRun.set(run);

    this.transcript.update((list) => {
      const dupe = list.find((e) => e.kind === 'agent' && e.run?.id === run.id);
      if (dupe) {
        return list.map((e) => (e.kind === 'agent' && e.run?.id === run.id ? { ...e, run } : e));
      }
      return [...list, { kind: 'agent', run, at: this.formatTime(run.startedAt) }];
    });

    this.shouldScroll = true;
    this.cdr.markForCheck();
    void this.api.checkHealth(); // warm health for the badge
  }
}
