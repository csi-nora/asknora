import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { StateService } from '../../services/state.service';

@Component({
  selector: 'app-governance-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
<div class="gov-root">
  <header class="gov-hdr">
    <a routerLink="/" class="gov-back">← Launcher</a>
    <div class="gov-title">
      <span class="gov-badge">🛡️</span>
      <div>
        <h1>CSI Nora · Agentic governance</h1>
        <p class="gov-sub">Policy, approvals, and audit-ready controls</p>
      </div>
    </div>
  </header>

  <section class="gov-section">
    <h2>Workspace</h2>
    <p class="gov-lead">
      This area is reserved for agentic governance flows: approval steps, policy packs,
      human-in-the-loop checkpoints, and integration with your audit trail.
    </p>
    <div class="gov-grid">
      <div class="gov-card">
        <h3>Audit readiness</h3>
        <p>Connect Ask Nora sessions to exportable evidence for PDPA / MAS-style reviews.</p>
      </div>
      <div class="gov-card">
        <h3>Policy gates</h3>
        <p>Define when automated actions require sign-off before execution.</p>
      </div>
      <div class="gov-card">
        <h3>Deployment tiers</h3>
        <p>Align sandbox and production lanes with your enterprise change process.</p>
      </div>
    </div>
    <p class="gov-note">
      Recent audit events (from this browser): <strong>{{ auditCount }}</strong> entries —
      open <a routerLink="/ask-nora">Ask Nora</a> for the full assistant, or
      <a routerLink="/both">Both</a> to switch experiences.
    </p>
  </section>
</div>
  `,
  styles: [`
    .gov-root{min-height:100vh;background:var(--bg,#0a0a0f);color:var(--text,#e8e8ef);padding:20px 24px 48px;font-family:var(--fd,'DM Sans',sans-serif)}
    .gov-hdr{margin-bottom:28px}
    .gov-back{display:inline-block;font-size:12px;color:var(--muted);text-decoration:none;margin-bottom:16px}
    .gov-back:hover{color:var(--red,#E0001A)}
    .gov-title{display:flex;align-items:flex-start;gap:14px}
    .gov-badge{font-size:36px}
    h1{margin:0;font-family:var(--fh,'Syne',sans-serif);font-size:1.35rem}
    .gov-sub{margin:6px 0 0;font-size:12px;color:var(--muted)}
    .gov-section{max-width:800px}
    h2{font-size:14px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 12px}
    .gov-lead{font-size:14px;line-height:1.55;margin:0 0 20px;color:var(--text)}
    .gov-grid{display:grid;gap:12px}
    @media(min-width:640px){.gov-grid{grid-template-columns:repeat(3,1fr)}}
    .gov-card{padding:14px;border-radius:12px;border:1px solid var(--border,#2a2a35);background:var(--card,#12121a)}
    .gov-card h3{margin:0 0 6px;font-size:13px}
    .gov-card p{margin:0;font-size:11px;color:var(--muted);line-height:1.45}
    .gov-note{font-size:12px;color:var(--muted);margin-top:24px;line-height:1.5}
    .gov-note a{color:var(--blue,#3b82f6)}
  `],
})
export class GovernancePageComponent {
  constructor(public st: StateService) {}

  get auditCount(): number {
    return this.st.auditEntries.length;
  }
}
