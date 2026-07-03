import { Injectable } from '@angular/core';
import { ChatHistoryEntry, HybridMode } from '../models';
import { StorageService } from './storage.service';

const MAX_ENTRIES = 50;
const MAX_CONTENT_CHARS = 120_000;

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ref-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function modeLabel(mode: HybridMode): string {
  if (mode === 'hybrid') {
    return 'Hybrid RAG';
  }
  if (mode === 'local') {
    return 'Local KB';
  }
  return 'Checking';
}

/**
 * Persists Ask Nora Q&A reference history via StorageService (localStorage).
 * Separate from the live session transcript; survives refresh; max 50 turns.
 */
@Injectable({ providedIn: 'root' })
export class ChatHistoryService {
  constructor(private readonly storage: StorageService) {}

  load(): ChatHistoryEntry[] {
    return this.storage.loadChatReference();
  }

  append(query: string, content: string, mode: HybridMode, docSources: string[], sectorLabel: string): void {
    const q = query.trim();
    if (!q) {
      return;
    }
    let body = content;
    if (body.length > MAX_CONTENT_CHARS) {
      body = body.slice(0, MAX_CONTENT_CHARS) + '\n\n[… truncated for storage …]';
    }
    const source = `${modeLabel(mode)} · ${sectorLabel}`;
    const entry: ChatHistoryEntry = {
      id: newId(),
      at: new Date().toISOString(),
      query: q,
      source,
      content: body,
      linkedFiles: [...docSources],
    };
    const next = [entry, ...this.load()].slice(0, MAX_ENTRIES);
    try {
      this.storage.saveChatReference(next);
    } catch {
      this.storage.saveChatReference(next.slice(0, Math.max(1, Math.floor(next.length / 2))));
    }
  }

  clear(): void {
    this.storage.clearChatReference();
  }

  exportJson(): string {
    return JSON.stringify(this.load(), null, 2);
  }
}
