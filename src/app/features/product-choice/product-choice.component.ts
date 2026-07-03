import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ProductExperience } from '../../models';
import { ProductModeService } from '../../services/product-mode.service';

@Component({
  selector: 'app-product-choice',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
<div class="pc-root">
  <div class="pc-brand">
    <div class="pc-logo">N</div>
    <div>
      <h1><span class="csi">CSI</span> Nora</h1>
      <p class="pc-sub">Choose your experience</p>
    </div>
  </div>

  <p class="pc-hint" *ngIf="productMode.preference() !== null">
    Last opened: <strong>{{ label(productMode.preference()!) }}</strong> —
    <button type="button" class="pc-link" (click)="go(productMode.preference()!)">Continue</button>
  </p>

  <div class="pc-grid">
    <button type="button" class="pc-card" (click)="choose('governance')">
      <div class="pc-icon">🛡️</div>
      <h2>CSI Nora · Agentic governance</h2>
      <p>Policy, audit trails, and agentic controls — enterprise governance workspace.</p>
      <span class="pc-cta">Open →</span>
    </button>

    <button type="button" class="pc-card pc-card-primary" (click)="choose('ask-nora')">
      <div class="pc-icon">💬</div>
      <h2>Ask Nora · Hybrid RAG enterprise bot</h2>
      <p>Sector-aware assistant with hybrid retrieval, documents, and Singtel CSI context.</p>
      <span class="pc-cta">Open →</span>
    </button>

    <button type="button" class="pc-card" (click)="choose('both')">
      <div class="pc-icon">🔀</div>
      <h2>Both</h2>
      <p>Switch between governance and Ask Nora in one session.</p>
      <span class="pc-cta">Open →</span>
    </button>

    <button type="button" class="pc-card pc-card-aco" (click)="choose('aichatops')">
      <div class="pc-icon">🤖</div>
      <h2>CSI Nora · AIChatOps</h2>
      <p>Agentic AI for chat-driven operations — typed tools, policy gates, audit-ready.</p>
      <span class="pc-cta">Open →</span>
    </button>
  </div>

  <label class="pc-remember">
    <input type="checkbox" [(ngModel)]="rememberChoice" />
    Remember my choice for “Continue” on next visit
  </label>
</div>
  `,
  styles: [`
    .pc-root{min-height:100vh;padding:32px 24px 48px;background:var(--bg,#0a0a0f);color:var(--text,#e8e8ef);
      font-family:var(--fd, 'DM Sans',sans-serif);max-width:960px;margin:0 auto}
    .pc-brand{display:flex;align-items:center;gap:16px;margin-bottom:8px}
    .pc-logo{width:48px;height:48px;background:linear-gradient(135deg,var(--red,#E0001A),#a00014);border-radius:12px;
      display:flex;align-items:center;justify-content:center;font-family:var(--fh,'Syne',sans-serif);font-weight:800;color:#fff;font-size:20px}
    h1{margin:0;font-family:var(--fh,'Syne',sans-serif);font-size:1.5rem;font-weight:700}
    .csi{color:var(--red,#E0001A)}
    .pc-sub{margin:4px 0 0;font-size:12px;color:var(--muted,#8b8b9a)}
    .pc-hint{font-size:13px;color:var(--muted);margin:16px 0 20px}
    .pc-link{background:none;border:none;color:var(--blue,#3b82f6);cursor:pointer;text-decoration:underline;padding:0;font:inherit}
    .pc-grid{display:grid;gap:14px}
    @media(min-width:720px){.pc-grid{grid-template-columns:1fr 1fr}}
    .pc-card{text-align:left;padding:20px;border-radius:14px;border:1px solid var(--border,#2a2a35);background:var(--card,#12121a);
      cursor:pointer;transition:border-color .2s,box-shadow .2s;color:inherit;font:inherit}
    .pc-card:hover{border-color:var(--red,#E0001A55);box-shadow:0 0 0 1px rgba(224,0,26,.2)}
    .pc-card-primary{border-color:rgba(224,0,26,.35)}
    .pc-card-aco{border-color:rgba(168,85,247,.35)}
    .pc-card-aco:hover{border-color:rgba(168,85,247,.55);box-shadow:0 0 0 1px rgba(168,85,247,.25)}
    .pc-card h2{margin:0 0 8px;font-size:15px;font-weight:600}
    .pc-card p{margin:0;font-size:12px;line-height:1.45;color:var(--muted)}
    .pc-icon{font-size:28px;margin-bottom:8px}
    .pc-cta{display:inline-block;margin-top:12px;font-size:12px;color:var(--red,#E0001A);font-weight:600}
    .pc-remember{display:flex;align-items:center;gap:8px;margin-top:28px;font-size:11px;color:var(--dim);cursor:pointer}
  `],
})
export class ProductChoiceComponent {
  rememberChoice = true;

  constructor(
    private router: Router,
    public productMode: ProductModeService,
  ) {}

  label(m: ProductExperience): string {
    const map: Record<ProductExperience, string> = {
      governance: 'Agentic governance',
      'ask-nora': 'Ask Nora (Hybrid RAG)',
      both: 'Both',
      aichatops: 'CSI Nora AIChatOps',
    };
    return map[m];
  }

  choose(mode: ProductExperience): void {
    if (this.rememberChoice) {
      this.productMode.save(mode);
    } else {
      this.productMode.clear();
    }
    this.go(mode);
  }

  go(mode: ProductExperience): void {
    if (mode === 'both') {
      void this.router.navigateByUrl('/both');
      return;
    }
    if (mode === 'governance') {
      void this.router.navigateByUrl('/governance');
      return;
    }
    if (mode === 'aichatops') {
      void this.router.navigateByUrl('/aichatops');
      return;
    }
    void this.router.navigateByUrl('/ask-nora');
  }
}
