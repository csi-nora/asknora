import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-both-layout',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
<div class="both-shell">
  <nav class="both-nav">
    <a routerLink="/" class="both-home">← Launcher</a>
    <div class="both-tabs">
      <a
        routerLink="ask-nora"
        routerLinkActive="active"
        [routerLinkActiveOptions]="{ exact: true }"
        class="both-tab"
      >Ask Nora</a>
      <a
        routerLink="governance"
        routerLinkActive="active"
        class="both-tab"
      >Governance</a>
    </div>
  </nav>
  <div class="both-outlet-wrap">
    <router-outlet />
  </div>
</div>
  `,
  styles: [`
    .both-shell{display:flex;flex-direction:column;height:100vh;overflow:hidden;background:var(--bg,#0a0a0f)}
    .both-nav{flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 16px;
      border-bottom:1px solid var(--border,#2a2a35);background:rgba(10,10,15,.97);z-index:150}
    .both-home{font-size:12px;color:var(--muted);text-decoration:none}
    .both-home:hover{color:var(--red,#E0001A)}
    .both-tabs{display:flex;gap:6px}
    .both-tab{padding:8px 14px;border-radius:8px;font-size:12px;font-weight:600;color:var(--muted);text-decoration:none;
      border:1px solid transparent}
    .both-tab:hover{color:var(--text)}
    .both-tab.active{color:var(--text);border-color:var(--border);background:var(--card,#12121a)}
    .both-outlet-wrap{flex:1;min-height:0;overflow:hidden}
    .both-outlet-wrap ::ng-deep app-ask-nora-page{display:block;height:100%}
    .both-outlet-wrap ::ng-deep app-governance-page{display:block;min-height:100%;overflow:auto}
  `],
})
export class BothLayoutComponent {}
