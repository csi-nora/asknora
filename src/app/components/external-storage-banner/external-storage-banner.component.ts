import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ExternalStorageService } from '../../services/external-storage.service';
import { StorageService } from '../../services/storage.service';

@Component({
  selector: 'app-external-storage-banner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ext-banner" *ngIf="ext.status$.value.showConnectPrompt">
      <span>
        <strong>Extended storage:</strong> link a USB or DASD folder to mirror session data beyond browser limits.
      </span>
      <div class="ext-actions">
        <button type="button" class="ext-btn" (click)="connect()" [disabled]="busy">
          {{ busy ? 'Opening…' : 'Connect folder' }}
        </button>
        <button type="button" class="ext-dismiss" (click)="dismiss()">Dismiss</button>
      </div>
    </div>
  `,
  styles: [`
    .ext-banner{
      position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:9999;
      max-width:min(640px,calc(100vw - 32px));padding:12px 16px;border-radius:12px;
      background:var(--card,#18181f);border:1px solid var(--border,#2a2a35);
      box-shadow:0 8px 32px rgba(0,0,0,.45);font-size:12px;color:var(--text,#f0f0f5);
      display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
    .ext-actions{display:flex;gap:8px;margin-left:auto}
    .ext-btn{padding:6px 12px;border-radius:8px;border:1px solid rgba(224,0,26,.45);
      background:rgba(224,0,26,.12);color:var(--text);cursor:pointer;font:inherit;font-size:11px}
    .ext-btn:disabled{opacity:.6;cursor:wait}
    .ext-dismiss{padding:6px 10px;border:none;background:transparent;color:var(--muted);cursor:pointer;font:inherit;font-size:11px}
  `],
})
export class ExternalStorageBannerComponent {
  busy = false;

  constructor(
    public ext: ExternalStorageService,
    private ss: StorageService,
  ) {}

  async connect(): Promise<void> {
    this.busy = true;
    try {
      await this.ext.connectExternalFolder(this.ss);
    } catch (e) {
      console.warn('External folder connect failed', e);
    } finally {
      this.busy = false;
    }
  }

  dismiss(): void {
    this.ext.dismissConnectPrompt();
  }
}
