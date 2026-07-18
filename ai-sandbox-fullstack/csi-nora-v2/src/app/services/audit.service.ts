import { Injectable } from '@angular/core';
import { AuditEntry, Sensitivity } from '../models';
import { StateService } from './state.service';

@Injectable({ providedIn: 'root' })
export class AuditService {
  constructor(private state: StateService) {}

  log(action: string, detail: string, sensitivity: Sensitivity): void {
    const now = new Date();
    this.state.addAudit({
      ts:   now.toISOString(),
      time: now.toTimeString().slice(0, 8),
      role: this.state.role(),
      action, detail, sensitivity
    });
  }

  downloadCsv(): void {
    let csv = 'Timestamp,Role,Action,Detail,Sensitivity\n';
    for (const e of this.state.auditEntries)
      csv += `"${e.ts}","${e.role}","${e.action}","${e.detail.replace(/"/g,'""')}","${e.sensitivity}"\n`;
    this._dl('csinora-audit-' + Date.now() + '.csv', csv, 'text/csv');
  }

  private _dl(name: string, content: string, type: string): void {
    const a = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(new Blob([content], { type })), download: name
    });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
