import { Injectable, inject, signal } from '@angular/core';
import { Subject } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { AuditService } from '../../services/audit.service';
import { StateService } from '../../services/state.service';

/**
 * CSI Nora · AIChatOps — agentic loop service.
 *
 * Implements a simple plan → tool-call → reflect loop with:
 *  - A typed tool registry (deterministic, browser-local simulations)
 *  - Policy gates that pause for human-in-the-loop approval on risky actions
 *  - Optional LLM polish step that calls the existing CSI Nora ApiService
 *    when an API key / gateway is configured (online "hybrid" mode), and
 *    falls back to a deterministic template summary when offline.
 *
 * Designed as a standalone service so the AIChatOps feature can run without
 * disturbing the Ask Nora workspace state.
 */

export type AIChatOpsRisk = 'safe' | 'review' | 'destructive';

export interface AIChatOpsTool {
  id: string;
  name: string;
  description: string;
  risk: AIChatOpsRisk;
  /** Suggested slash-command alias users can type to invoke the tool directly. */
  slash?: string;
}

export type AIChatOpsToolId =
  | 'kb_search'
  | 'metrics_query'
  | 'incident_query'
  | 'deploy_status'
  | 'policy_check'
  | 'runbook_lookup'
  | 'cost_audit'
  | 'audit_log'
  | 'deploy_service'
  | 'rollback_service'
  | 'escalate_oncall';

export interface AIChatOpsStep {
  id: string;
  toolId: AIChatOpsToolId;
  toolName: string;
  intent: string;
  args: Record<string, string>;
  status: 'pending' | 'awaiting-approval' | 'running' | 'ok' | 'denied' | 'error';
  startedAt?: string;
  finishedAt?: string;
  output?: string;
  outputLines?: string[];
  risk: AIChatOpsRisk;
  requiresApproval?: boolean;
}

export type AIChatOpsRunStatus =
  | 'planning'
  | 'running'
  | 'awaiting-approval'
  | 'awaiting-llm'
  | 'complete'
  | 'cancelled'
  | 'error';

export interface AIChatOpsRun {
  id: string;
  userQuery: string;
  startedAt: string;
  finishedAt?: string;
  steps: AIChatOpsStep[];
  finalAnswer?: string;
  status: AIChatOpsRunStatus;
  llmMode?: 'hybrid' | 'local';
}

export interface AIChatOpsPlaybook {
  id: string;
  name: string;
  icon: string;
  description: string;
  prompt: string;
}

interface PlanTemplate {
  intent: string;
  match: (q: string) => boolean;
  build: (q: string) => Array<Pick<AIChatOpsStep, 'toolId' | 'intent' | 'args' | 'toolName' | 'risk' | 'requiresApproval'>>;
}

const TOOL_REGISTRY: Record<AIChatOpsToolId, AIChatOpsTool> = {
  kb_search:        { id: 'kb_search',        name: 'kb.search',        description: 'Search CSI Nora knowledge base for runbooks, FAQs and policy notes.',                risk: 'safe',        slash: '/kb' },
  metrics_query:    { id: 'metrics_query',    name: 'metrics.query',    description: 'Query latency, error-rate and saturation metrics for a service.',                  risk: 'safe',        slash: '/metrics' },
  incident_query:   { id: 'incident_query',   name: 'incidents.query',  description: 'List active and recent incidents from the NOC queue.',                              risk: 'safe',        slash: '/incidents' },
  deploy_status:    { id: 'deploy_status',    name: 'deploy.status',    description: 'Check current deployment status & last successful release for a service.',          risk: 'safe',        slash: '/status' },
  policy_check:     { id: 'policy_check',     name: 'policy.check',     description: 'Validate an action against PDPA / MAS TRM / change-control policies.',              risk: 'safe',        slash: '/policy' },
  runbook_lookup:   { id: 'runbook_lookup',   name: 'runbook.lookup',   description: 'Fetch the recommended runbook steps for a known alert pattern.',                    risk: 'safe',        slash: '/runbook' },
  cost_audit:       { id: 'cost_audit',       name: 'cost.audit',       description: 'Summarise spend, top cost drivers and savings opportunities for a service.',        risk: 'safe',        slash: '/cost' },
  audit_log:        { id: 'audit_log',        name: 'audit.log',        description: 'Write an immutable entry to the CSI Nora audit trail.',                             risk: 'safe',        slash: '/audit' },
  deploy_service:   { id: 'deploy_service',   name: 'deploy.execute',   description: 'Trigger a deployment of a service to a target environment. Requires approval.',     risk: 'destructive', slash: '/deploy',   },
  rollback_service: { id: 'rollback_service', name: 'rollback.execute', description: 'Roll a service back to a previous release. Requires approval.',                     risk: 'destructive', slash: '/rollback' },
  escalate_oncall:  { id: 'escalate_oncall',  name: 'oncall.escalate',  description: 'Page the on-call engineer for a service. Requires approval.',                       risk: 'review',      slash: '/escalate' },
};

const PLAYBOOKS: AIChatOpsPlaybook[] = [
  { id: 'triage',     name: 'Incident triage',     icon: '🚨', description: 'Pull active incidents, latest metrics and likely runbook for a service.', prompt: 'Triage the most recent incident for the payments service and recommend next steps.' },
  { id: 'deploy',     name: 'Deploy service',      icon: '🚀', description: 'Check status, run policy gate, then propose a deploy of a service.',       prompt: 'I want to deploy the payments-api service to production. Walk through the safety checks.' },
  { id: 'rollback',   name: 'Rollback',            icon: '⏪', description: 'Roll a service back to the previous green release with audit trail.',      prompt: 'Roll back the checkout service to the previous release because of elevated 5xx errors.' },
  { id: 'compliance', name: 'Compliance review',   icon: '🛡️', description: 'Check PDPA / MAS TRM / CSA posture for an action or workload.',            prompt: 'Compliance review: storing customer KYC documents in the new SG-East S3 bucket.' },
  { id: 'cost',       name: 'Cost audit',          icon: '💰', description: 'Summarise spend, drivers and quick savings for a workload.',              prompt: 'Run a cost audit on the data-platform workload for last month and suggest savings.' },
  { id: 'kb',         name: 'Knowledge lookup',    icon: '📚', description: 'Search runbooks, FAQs and policy notes for a free-text question.',         prompt: 'What is our process for handling a tier-1 outage on the customer portal?' },
];

@Injectable({ providedIn: 'root' })
export class AIChatOpsAgentService {
  private readonly api = inject(ApiService);
  private readonly state = inject(StateService);
  private readonly audit = inject(AuditService);

  /** Stream of run lifecycle events the page subscribes to. */
  readonly events$ = new Subject<{ type: 'run' | 'step'; run: AIChatOpsRun }>();

  /** Reactive flag — true while the loop is actively running tools. */
  readonly busy = signal<boolean>(false);

  /** Last LLM polish mode observed (hybrid = online, local = offline). */
  readonly lastLlmMode = signal<'hybrid' | 'local' | null>(null);

  readonly tools: ReadonlyArray<AIChatOpsTool> = Object.values(TOOL_REGISTRY);
  readonly playbooks: ReadonlyArray<AIChatOpsPlaybook> = PLAYBOOKS;

  private runCounter = 0;
  private stepCounter = 0;

  // ─────────────────────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────────────────────

  /** Build an initial run with planned steps and start executing the safe prefix. */
  async start(userQuery: string): Promise<AIChatOpsRun> {
    const plan = this.buildPlan(userQuery);
    const run: AIChatOpsRun = {
      id: 'run-' + (++this.runCounter) + '-' + Date.now().toString(36),
      userQuery,
      startedAt: new Date().toISOString(),
      steps: plan.map((p) => ({
        id: 'step-' + (++this.stepCounter),
        toolId: p.toolId,
        toolName: p.toolName,
        intent: p.intent,
        args: p.args,
        risk: p.risk,
        requiresApproval: p.requiresApproval,
        status: p.requiresApproval ? 'awaiting-approval' : 'pending',
      })),
      status: 'planning',
    };

    this.events$.next({ type: 'run', run });
    this.audit.log('aichatops.run.start', this.truncate(userQuery, 200), 'internal');
    await this.advance(run);
    return run;
  }

  /** User approved a pending destructive step; resume execution. */
  async approve(run: AIChatOpsRun, stepId: string): Promise<void> {
    const step = run.steps.find((s) => s.id === stepId);
    if (!step || step.status !== 'awaiting-approval') {
      return;
    }
    step.status = 'pending';
    this.audit.log('aichatops.step.approve', `${step.toolName} :: ${step.intent}`, 'internal');
    this.events$.next({ type: 'step', run });
    await this.advance(run);
  }

  /** User denied a pending destructive step; mark run cancelled. */
  deny(run: AIChatOpsRun, stepId: string): void {
    const step = run.steps.find((s) => s.id === stepId);
    if (!step) {
      return;
    }
    step.status = 'denied';
    step.finishedAt = new Date().toISOString();
    run.status = 'cancelled';
    run.finishedAt = new Date().toISOString();
    run.finalAnswer =
      `Run cancelled — operator declined the ${step.toolName} step ` +
      `for "${step.intent}". No destructive actions were performed.`;
    this.busy.set(false);
    this.audit.log('aichatops.step.deny', `${step.toolName} :: ${step.intent}`, 'internal');
    this.events$.next({ type: 'run', run });
  }

  /** Cancel an entire in-flight run. */
  cancel(run: AIChatOpsRun): void {
    if (run.status === 'complete' || run.status === 'cancelled') {
      return;
    }
    run.status = 'cancelled';
    run.finishedAt = new Date().toISOString();
    run.finalAnswer = run.finalAnswer ?? 'Run cancelled by operator before completion.';
    for (const s of run.steps) {
      if (s.status === 'pending' || s.status === 'awaiting-approval' || s.status === 'running') {
        s.status = 'denied';
        s.finishedAt = new Date().toISOString();
      }
    }
    this.busy.set(false);
    this.audit.log('aichatops.run.cancel', this.truncate(run.userQuery, 200), 'internal');
    this.events$.next({ type: 'run', run });
  }

  // ─────────────────────────────────────────────────────────────
  // Internal — agent loop
  // ─────────────────────────────────────────────────────────────

  private async advance(run: AIChatOpsRun): Promise<void> {
    this.busy.set(true);
    run.status = 'running';
    this.events$.next({ type: 'run', run });

    for (const step of run.steps) {
      if (step.status === 'awaiting-approval') {
        run.status = 'awaiting-approval';
        this.events$.next({ type: 'run', run });
        this.busy.set(false);
        return;
      }
      if (step.status !== 'pending') {
        continue;
      }

      step.status = 'running';
      step.startedAt = new Date().toISOString();
      this.events$.next({ type: 'step', run });

      await this.sleep(420 + Math.random() * 360);

      try {
        const { output, lines } = this.executeTool(step);
        step.output = output;
        step.outputLines = lines;
        step.status = 'ok';
      } catch (e: unknown) {
        step.output = e instanceof Error ? e.message : 'Unknown tool error.';
        step.status = 'error';
      }
      step.finishedAt = new Date().toISOString();
      this.events$.next({ type: 'step', run });

      if (step.status === 'error') {
        run.status = 'error';
        run.finishedAt = new Date().toISOString();
        run.finalAnswer = `Run halted — tool **${step.toolName}** failed: ${step.output}`;
        this.busy.set(false);
        this.events$.next({ type: 'run', run });
        return;
      }
    }

    run.status = 'awaiting-llm';
    this.events$.next({ type: 'run', run });
    const summary = await this.synthesizeFinal(run);
    run.finalAnswer = summary.text;
    run.llmMode = summary.mode;
    run.status = 'complete';
    run.finishedAt = new Date().toISOString();
    this.lastLlmMode.set(summary.mode);
    this.audit.log('aichatops.run.complete', `${run.steps.length} step(s) · mode=${summary.mode}`, 'internal');
    this.busy.set(false);
    this.events$.next({ type: 'run', run });
  }

  // ─────────────────────────────────────────────────────────────
  // Planner
  // ─────────────────────────────────────────────────────────────

  private buildPlan(query: string): ReturnType<PlanTemplate['build']> {
    const q = query.trim();
    const lower = q.toLowerCase();

    const slash = this.matchSlashCommand(q);
    if (slash) {
      return slash;
    }

    for (const tpl of this.planTemplates) {
      if (tpl.match(lower)) {
        return tpl.build(q);
      }
    }

    return [this.step('kb_search', 'Search the CSI Nora knowledge base for context', { query: this.truncate(q, 120) })];
  }

  private matchSlashCommand(q: string): ReturnType<PlanTemplate['build']> | null {
    if (!q.startsWith('/')) {
      return null;
    }
    const [cmd, ...rest] = q.split(/\s+/);
    const arg = rest.join(' ').trim() || 'payments-api';
    switch (cmd.toLowerCase()) {
      case '/kb':
        return [this.step('kb_search', `Search knowledge base for "${arg}"`, { query: arg })];
      case '/metrics':
        return [this.step('metrics_query', `Pull metrics for ${arg}`, { service: arg })];
      case '/incidents':
        return [this.step('incident_query', `List active incidents${arg ? ` for ${arg}` : ''}`, { scope: arg })];
      case '/status':
        return [this.step('deploy_status', `Check deploy status of ${arg}`, { service: arg })];
      case '/policy':
        return [this.step('policy_check', `Policy check for "${arg}"`, { action: arg })];
      case '/runbook':
        return [this.step('runbook_lookup', `Look up runbook for ${arg}`, { topic: arg })];
      case '/cost':
        return [this.step('cost_audit', `Cost audit for ${arg}`, { workload: arg })];
      case '/deploy':
        return [
          this.step('deploy_status', `Pre-flight: current state of ${arg}`, { service: arg }),
          this.step('policy_check', `Change-control policy gate for deploying ${arg}`, { action: `deploy ${arg}` }),
          this.step('deploy_service', `Deploy ${arg} to production`, { service: arg, env: 'production' }, true),
          this.step('audit_log', `Record deployment of ${arg}`, { event: 'deploy', service: arg }),
        ];
      case '/rollback':
        return [
          this.step('deploy_status', `Confirm current and previous release of ${arg}`, { service: arg }),
          this.step('rollback_service', `Roll ${arg} back to the previous release`, { service: arg }, true),
          this.step('audit_log', `Record rollback of ${arg}`, { event: 'rollback', service: arg }),
        ];
      case '/escalate':
        return [
          this.step('incident_query', `Pull incidents related to ${arg} for context`, { scope: arg }),
          this.step('escalate_oncall', `Page on-call engineer for ${arg}`, { service: arg }, true),
          this.step('audit_log', `Record on-call escalation for ${arg}`, { event: 'escalate', service: arg }),
        ];
      case '/audit':
        return [this.step('audit_log', `Record note "${arg}"`, { event: 'note', detail: arg })];
      default:
        return null;
    }
  }

  private readonly planTemplates: PlanTemplate[] = [
    {
      intent: 'triage',
      match: (q) => /(triage|outage|incident|alert|page|p1|p2|sev[- ]?\d)/.test(q),
      build: (q) => {
        const svc = this.extractService(q) || 'payments-api';
        return [
          this.step('incident_query', `Pull active incidents for ${svc}`, { scope: svc }),
          this.step('metrics_query', `Inspect latency/error-rate for ${svc}`, { service: svc }),
          this.step('runbook_lookup', `Find runbook for symptoms in ${svc}`, { topic: svc }),
          this.step('audit_log', `Log triage session for ${svc}`, { event: 'triage', service: svc }),
        ];
      },
    },
    {
      intent: 'deploy',
      match: (q) => /(deploy|release|push to (prod|production)|ship)/.test(q),
      build: (q) => {
        const svc = this.extractService(q) || 'payments-api';
        return [
          this.step('deploy_status', `Check current deployment state of ${svc}`, { service: svc }),
          this.step('policy_check', `Change-control policy gate for ${svc}`, { action: `deploy ${svc}` }),
          this.step('deploy_service', `Deploy ${svc} to production`, { service: svc, env: 'production' }, true),
          this.step('audit_log', `Record deployment of ${svc}`, { event: 'deploy', service: svc }),
        ];
      },
    },
    {
      intent: 'rollback',
      match: (q) => /(rollback|roll back|revert release|previous release)/.test(q),
      build: (q) => {
        const svc = this.extractService(q) || 'checkout-service';
        return [
          this.step('deploy_status', `Confirm current and previous release of ${svc}`, { service: svc }),
          this.step('rollback_service', `Roll ${svc} back to the previous release`, { service: svc }, true),
          this.step('audit_log', `Record rollback of ${svc}`, { event: 'rollback', service: svc }),
        ];
      },
    },
    {
      intent: 'compliance',
      match: (q) => /(pdpa|mas|trm|csa|imda|compliance|regulator|audit-ready)/.test(q),
      build: (q) => [
        this.step('policy_check', 'Evaluate PDPA / MAS TRM / CSA posture', { action: this.truncate(q, 120) }),
        this.step('kb_search', 'Cite relevant policy notes', { query: this.truncate(q, 120) }),
        this.step('audit_log', 'Record compliance review', { event: 'compliance-review', detail: this.truncate(q, 120) }),
      ],
    },
    {
      intent: 'cost',
      match: (q) => /(cost|spend|bill|finops|savings|budget)/.test(q),
      build: (q) => {
        const wl = this.extractService(q) || 'data-platform';
        return [
          this.step('cost_audit', `Summarise spend for ${wl}`, { workload: wl }),
          this.step('kb_search', `FinOps recommendations for ${wl}`, { query: `finops ${wl}` }),
        ];
      },
    },
    {
      intent: 'metrics',
      match: (q) => /(latency|p9\d|error rate|saturation|metric|cpu|memory|slo|sli)/.test(q),
      build: (q) => {
        const svc = this.extractService(q) || 'customer-portal';
        return [
          this.step('metrics_query', `Pull SLI metrics for ${svc}`, { service: svc }),
          this.step('incident_query', `Cross-check incidents for ${svc}`, { scope: svc }),
        ];
      },
    },
    {
      intent: 'kb',
      match: () => true,
      build: (q) => [this.step('kb_search', `Search knowledge base for "${this.truncate(q, 80)}"`, { query: this.truncate(q, 120) })],
    },
  ];

  // ─────────────────────────────────────────────────────────────
  // Tool execution (deterministic browser-local simulations)
  // ─────────────────────────────────────────────────────────────

  private executeTool(step: AIChatOpsStep): { output: string; lines: string[] } {
    switch (step.toolId) {
      case 'kb_search':         return this.toolKbSearch(step.args['query'] || '');
      case 'metrics_query':     return this.toolMetrics(step.args['service'] || 'unknown-service');
      case 'incident_query':    return this.toolIncidents(step.args['scope'] || '');
      case 'deploy_status':     return this.toolDeployStatus(step.args['service'] || 'unknown-service');
      case 'policy_check':      return this.toolPolicyCheck(step.args['action'] || step.intent);
      case 'runbook_lookup':    return this.toolRunbook(step.args['topic'] || step.args['service'] || 'generic');
      case 'cost_audit':        return this.toolCostAudit(step.args['workload'] || 'unknown-workload');
      case 'audit_log':         return this.toolAuditLog(step.args, step.intent);
      case 'deploy_service':    return this.toolDeployService(step.args['service'] || 'service', step.args['env'] || 'production');
      case 'rollback_service':  return this.toolRollback(step.args['service'] || 'service');
      case 'escalate_oncall':   return this.toolEscalate(step.args['service'] || 'service');
    }
  }

  private toolKbSearch(query: string): { output: string; lines: string[] } {
    const q = query.toLowerCase();
    const hits: string[] = [];
    if (/(pdpa|kyc|data residency|personal data)/.test(q)) {
      hits.push('RB-014 · PDPA handling for customer KYC artifacts (SG-East region only).');
    }
    if (/(mas|trm|finance|banking|payments)/.test(q)) {
      hits.push('RB-027 · MAS TRM change-control: dual approval + 24h soak in sandbox before prod.');
    }
    if (/(outage|p1|tier[- ]?1|critical)/.test(q)) {
      hits.push('RB-002 · Tier-1 outage runbook: open bridge, page on-call lead, status page within 15 min.');
    }
    if (/(deploy|release|rollback)/.test(q)) {
      hits.push('RB-031 · Standard deploy checklist (status → policy gate → canary 10% → 100%).');
    }
    if (/(cost|spend|finops|bill)/.test(q)) {
      hits.push('RB-044 · FinOps quick wins: rightsize idle nodes, schedule non-prod, lifecycle S3.');
    }
    if (!hits.length) {
      hits.push('FAQ-100 · Generic CSI Nora operating model and escalation contacts.');
      hits.push('FAQ-101 · How to file a change request via the governance workspace.');
    }
    return { output: `Top results for "${query}":`, lines: hits.map((h, i) => `${i + 1}. ${h}`) };
  }

  private toolMetrics(service: string): { output: string; lines: string[] } {
    const p95 = (180 + Math.floor(Math.random() * 220)).toString();
    const err = (Math.random() * 1.4).toFixed(2);
    const sat = (40 + Math.floor(Math.random() * 50)).toString();
    return {
      output: `Metrics for ${service} (last 15 min)`,
      lines: [
        `p95 latency  : ${p95} ms  (SLO 250 ms)`,
        `error rate   : ${err} %   (SLO 0.5 %)`,
        `saturation   : ${sat} %   (warn 80 %)`,
        `5xx hot path : POST /checkout, GET /balance`,
      ],
    };
  }

  private toolIncidents(scope: string): { output: string; lines: string[] } {
    const label = scope ? ` in scope "${scope}"` : '';
    return {
      output: `Active and recent incidents${label}:`,
      lines: [
        'INC-7421 · OPEN  · P2 · payments-api · elevated 5xx since 14:03',
        'INC-7418 · ACK   · P3 · checkout-service · canary failing health probe',
        'INC-7402 · CLOSE · P3 · customer-portal · resolved 23 min ago',
      ],
    };
  }

  private toolDeployStatus(service: string): { output: string; lines: string[] } {
    return {
      output: `Deploy status · ${service}`,
      lines: [
        `current release : v4.18.2  (deployed 6 days ago, healthy)`,
        `previous release: v4.18.1  (last green)`,
        `pending PRs     : 3 merged, awaiting release train`,
        `canary slot     : free`,
      ],
    };
  }

  private toolPolicyCheck(action: string): { output: string; lines: string[] } {
    const a = action.toLowerCase();
    const findings: string[] = [];
    if (a.includes('deploy') || a.includes('rollback')) {
      findings.push('MAS TRM §6 · dual approval required for production change.');
      findings.push('Change window : within standard ops window (Tue–Thu 10:00–16:00 SGT).');
    }
    if (a.includes('kyc') || a.includes('pdpa')) {
      findings.push('PDPA §13 · keep KYC artifacts in SG-East only; no cross-region replication.');
    }
    if (!findings.length) {
      findings.push('No policy controls matched — action treated as low-risk informational.');
    }
    findings.push('Verdict     : ALLOWED with human approval where flagged.');
    return { output: `Policy gate for "${action}"`, lines: findings };
  }

  private toolRunbook(topic: string): { output: string; lines: string[] } {
    return {
      output: `Runbook suggestions for ${topic}`,
      lines: [
        '1. Confirm scope (single tenant vs platform-wide) on the status board.',
        '2. Open the war-room bridge and page on-call lead via /escalate.',
        '3. Snapshot metrics + recent deploys for the affected service.',
        '4. If error budget burn > 2x — initiate rollback to last green.',
        '5. Post status update every 15 min until mitigated.',
      ],
    };
  }

  private toolCostAudit(workload: string): { output: string; lines: string[] } {
    const total = (1200 + Math.floor(Math.random() * 3800)).toLocaleString();
    return {
      output: `Cost audit · ${workload} (last 30 days)`,
      lines: [
        `total spend    : S$ ${total}`,
        `top driver     : compute · ~58% (idle nodes overnight)`,
        `second driver  : egress  · ~18% (cross-region traffic)`,
        `quick wins     : schedule non-prod off-hours · lifecycle S3 → IA`,
        `est. savings   : 18–24% with no functional change`,
      ],
    };
  }

  private toolAuditLog(args: Record<string, string>, intent: string): { output: string; lines: string[] } {
    const event = args['event'] || 'note';
    const detail = args['detail'] || args['service'] || intent;
    this.audit.log(`aichatops.${event}`, this.truncate(detail, 200), 'internal');
    return {
      output: `Audit entry written`,
      lines: [
        `event  : ${event}`,
        `detail : ${this.truncate(detail, 120)}`,
        `role   : ${this.state.role()}`,
        `sink   : CSI Nora audit trail (browser-local)`,
      ],
    };
  }

  private toolDeployService(service: string, env: string): { output: string; lines: string[] } {
    const release = 'v4.18.' + (3 + Math.floor(Math.random() * 4));
    return {
      output: `Deployed ${service} → ${env}`,
      lines: [
        `released   : ${release}`,
        `strategy   : canary 10% → 50% → 100% (auto-promote on green probes)`,
        `health     : all probes green at 3 min mark`,
        `rollback   : available via /rollback ${service}`,
      ],
    };
  }

  private toolRollback(service: string): { output: string; lines: string[] } {
    return {
      output: `Rolled ${service} back to previous release`,
      lines: [
        `target release : last green tag`,
        `strategy       : blue/green flip (zero-downtime)`,
        `health         : green probes recovered within 90s`,
        `follow-up      : open INC ticket if regression repeats`,
      ],
    };
  }

  private toolEscalate(service: string): { output: string; lines: string[] } {
    return {
      output: `Paged on-call for ${service}`,
      lines: [
        `primary  : oncall-${service}@csi.singtel`,
        `channel  : #incidents-bridge`,
        `ack SLA  : 5 min for P1, 15 min for P2`,
        `note     : escalation logged with audit trail`,
      ],
    };
  }

  // ─────────────────────────────────────────────────────────────
  // Final answer synthesis (LLM polish + local fallback)
  // ─────────────────────────────────────────────────────────────

  private async synthesizeFinal(run: AIChatOpsRun): Promise<{ text: string; mode: 'hybrid' | 'local' }> {
    const local = this.localSummary(run);

    try {
      const online = await this.api.checkHealth();
      const prov = this.state.api.provider;
      const hasKey = !!this.state.api.keys[prov];
      if (!online || !hasKey) {
        return { text: local, mode: 'local' };
      }
      const result = await this.api.send(this.buildLlmPrompt(run, local), this.state.sector() || 'sme', this.state.docs);
      const trimmed = (result.reply || '').trim();
      if (!trimmed) {
        return { text: local, mode: 'local' };
      }
      return { text: trimmed, mode: result.mode === 'hybrid' ? 'hybrid' : 'local' };
    } catch {
      return { text: local, mode: 'local' };
    }
  }

  private buildLlmPrompt(run: AIChatOpsRun, baseline: string): string {
    const trace = run.steps
      .map((s) => `- ${s.toolName} (${s.status}) — ${s.intent}\n  output: ${(s.outputLines || []).join(' | ') || s.output || ''}`)
      .join('\n');
    return [
      'You are CSI Nora AIChatOps — a senior Singtel CSI SRE.',
      'Summarise the agent run below for a chat-ops operator in 6–10 lines.',
      'Be specific, action-oriented, and call out anything that still needs human follow-up.',
      'Do NOT invent tool outputs — only use the trace.',
      '',
      `OPERATOR REQUEST:\n${run.userQuery}`,
      '',
      `AGENT TRACE:\n${trace}`,
      '',
      `BASELINE SUMMARY (template, refine but keep the facts):\n${baseline}`,
    ].join('\n');
  }

  private localSummary(run: AIChatOpsRun): string {
    const lines: string[] = [];
    lines.push(`**CSI Nora AIChatOps · run summary**`);
    lines.push('');
    lines.push(`Operator request: _${run.userQuery}_`);
    lines.push('');
    const ok = run.steps.filter((s) => s.status === 'ok').length;
    const denied = run.steps.filter((s) => s.status === 'denied').length;
    const errored = run.steps.filter((s) => s.status === 'error').length;
    lines.push(`Executed ${ok}/${run.steps.length} step(s) · denied: ${denied} · errored: ${errored}.`);
    lines.push('');
    for (const s of run.steps) {
      const tag =
        s.status === 'ok'        ? '✅' :
        s.status === 'denied'    ? '⛔' :
        s.status === 'error'     ? '❌' :
        s.status === 'awaiting-approval' ? '⏸️' : '…';
      lines.push(`${tag} ${s.toolName} — ${s.intent}`);
      if (s.outputLines?.length) {
        for (const o of s.outputLines.slice(0, 4)) {
          lines.push(`   · ${o}`);
        }
      } else if (s.output) {
        lines.push(`   · ${s.output}`);
      }
    }
    lines.push('');
    lines.push(`_Audit trail updated. Re-run with /policy or /audit for compliance evidence._`);
    return lines.join('\n');
  }

  // ─────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────

  private step(
    toolId: AIChatOpsToolId,
    intent: string,
    args: Record<string, string>,
    requiresApproval = false,
  ): { toolId: AIChatOpsToolId; intent: string; args: Record<string, string>; toolName: string; risk: AIChatOpsRisk; requiresApproval: boolean } {
    const tool = TOOL_REGISTRY[toolId];
    return {
      toolId,
      intent,
      args,
      toolName: tool.name,
      risk: tool.risk,
      requiresApproval: requiresApproval || tool.risk === 'destructive',
    };
  }

  private extractService(q: string): string | null {
    const m = q.match(/\b([a-z][a-z0-9-]{2,}-(?:api|service|gateway|portal|platform|worker|db))\b/i);
    if (m) {
      return m[1];
    }
    const known = ['payments-api', 'checkout-service', 'customer-portal', 'data-platform', 'auth-gateway', 'billing-worker'];
    for (const k of known) {
      if (q.toLowerCase().includes(k)) {
        return k;
      }
    }
    return null;
  }

  private truncate(s: string, max: number): string {
    return s.length <= max ? s : s.slice(0, max - 1) + '…';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
