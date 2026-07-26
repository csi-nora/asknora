import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import type { ExternalStorageStatus } from '../models';
import type { StorageService } from './storage.service';

const HANDLE_KEY = 'csi-nora-external-dir';
const MIRROR_DIR = '.csi-nora';
const PROMPT_DISMISS_KEY = 'csi-nora-ext-banner-dismissed';

/** Keys mirrored to OPFS / external folder (not API secrets). */
const MIRRORABLE_PREFIXES = ['csinora_', 'csi-nora-'];

@Injectable({ providedIn: 'root' })
export class ExternalStorageService {
  readonly status$ = new BehaviorSubject<ExternalStorageStatus>({
    tier: 'local',
    opfsAvailable: false,
    externalConnected: false,
    externalFolderName: null,
    showConnectPrompt: false,
  });

  private opfsRoot: FileSystemDirectoryHandle | null = null;
  private externalDir: FileSystemDirectoryHandle | null = null;
  private readonly mirrorQueue = new Map<string, string>();

  /** APP_INITIALIZER — hydrate OPFS/external tiers and reconnect folder handles. */
  async hydrateOnStartup(ss: StorageService): Promise<void> {
    const opfsAvailable = await this.initOpfs();
    await this.tryReconnectExternal(ss);
    this.refreshStatus(opfsAvailable);
    await this.flushMirrors();
    await this.hydrateFromExtendedTiers(ss);
  }

  mirrorKey(key: string, raw: string): void {
    if (!this.isMirrorable(key)) {
      return;
    }
    this.mirrorQueue.set(key, raw);
    void this.flushMirrors();
  }

  removeMirroredKey(key: string): void {
    this.mirrorQueue.delete(key);
    void this.deleteMirroredFile(key);
  }

  async connectExternalFolder(ss: StorageService): Promise<void> {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('Folder linking is not supported in this browser.');
    }
    const dir = await (window as Window & { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> })
      .showDirectoryPicker();
    await this.persistHandle(dir);
    this.externalDir = dir;
    localStorage.setItem(PROMPT_DISMISS_KEY, '1');
    this.refreshStatus(!!this.opfsRoot);
    await this.flushMirrors();
    await this.hydrateFromExtendedTiers(ss);
  }

  dismissConnectPrompt(): void {
    localStorage.setItem(PROMPT_DISMISS_KEY, '1');
    this.status$.next({ ...this.status$.value, showConnectPrompt: false });
  }

  private isMirrorable(key: string): boolean {
    return MIRRORABLE_PREFIXES.some((p) => key.startsWith(p));
  }

  private async initOpfs(): Promise<boolean> {
    try {
      if (!('storage' in navigator) || !navigator.storage.getDirectory) {
        return false;
      }
      this.opfsRoot = await navigator.storage.getDirectory();
      return true;
    } catch {
      return false;
    }
  }

  private async tryReconnectExternal(ss: StorageService): Promise<void> {
    try {
      const db = await this.openHandleDb();
      const handle = await this.readHandle(db);
      if (!handle) {
        return;
      }
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.externalDir = handle;
        return;
      }
      const req = await handle.requestPermission({ mode: 'readwrite' });
      if (req === 'granted') {
        this.externalDir = handle;
      }
    } catch {
      /* user may deny or volume unplugged */
    }
  }

  private refreshStatus(opfsAvailable: boolean): void {
    const externalConnected = !!this.externalDir;
    const fsApi = 'showDirectoryPicker' in window;
    const dismissed = localStorage.getItem(PROMPT_DISMISS_KEY) === '1';
    let tier: ExternalStorageStatus['tier'] = 'local';
    if (externalConnected) {
      tier = 'external';
    } else if (opfsAvailable) {
      tier = 'opfs';
    }

    this.status$.next({
      tier,
      opfsAvailable,
      externalConnected,
      externalFolderName: this.externalDir?.name ?? null,
      showConnectPrompt: fsApi && !externalConnected && !dismissed,
    });
  }

  private async hydrateFromExtendedTiers(ss: StorageService): Promise<void> {
    const keys = [...this.mirrorQueue.keys()];
    if (!keys.length && this.externalDir) {
      await this.readExternalIntoCache(ss);
    }
    for (const [key, raw] of this.mirrorQueue) {
      if (ss.getStringWithFallback(key) == null) {
        ss.ingestFromExtendedTier(key, raw);
      }
    }
  }

  private async readExternalIntoCache(ss: StorageService): Promise<void> {
    if (!this.externalDir) {
      return;
    }
    try {
      const mirror = await this.externalDir.getDirectoryHandle(MIRROR_DIR, { create: false });
      for await (const [name, handle] of (mirror as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>)) {
        if (handle.kind !== 'file' || !name.endsWith('.json')) {
          continue;
        }
        const file = await (handle as FileSystemFileHandle).getFile();
        const key = name.replace(/\.json$/, '');
        const raw = await file.text();
        this.mirrorQueue.set(key, raw);
        if (ss.getStringWithFallback(key) == null) {
          ss.ingestFromExtendedTier(key, raw);
        }
      }
    } catch {
      /* mirror dir may not exist yet */
    }
  }

  private async flushMirrors(): Promise<void> {
    if (!this.mirrorQueue.size) {
      return;
    }
    const entries = [...this.mirrorQueue.entries()];
    for (const [key, raw] of entries) {
      await this.writeOpfs(key, raw);
      await this.writeExternal(key, raw);
    }
  }

  private async writeOpfs(key: string, raw: string): Promise<void> {
    if (!this.opfsRoot) {
      return;
    }
    try {
      const file = await this.opfsRoot.getFileHandle(`${key}.json`, { create: true });
      const writable = await file.createWritable();
      await writable.write(raw);
      await writable.close();
    } catch {
      /* non-fatal */
    }
  }

  private async writeExternal(key: string, raw: string): Promise<void> {
    if (!this.externalDir) {
      return;
    }
    try {
      const mirror = await this.externalDir.getDirectoryHandle(MIRROR_DIR, { create: true });
      const file = await mirror.getFileHandle(`${key}.json`, { create: true });
      const writable = await file.createWritable();
      await writable.write(raw);
      await writable.close();
    } catch {
      /* volume may be unplugged */
    }
  }

  private async deleteMirroredFile(key: string): Promise<void> {
    try {
      if (this.opfsRoot) {
        await this.opfsRoot.removeEntry(`${key}.json`);
      }
    } catch {
      /* ignore */
    }
    try {
      if (this.externalDir) {
        const mirror = await this.externalDir.getDirectoryHandle(MIRROR_DIR, { create: false });
        await mirror.removeEntry(`${key}.json`);
      }
    } catch {
      /* ignore */
    }
  }

  private async persistHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    const db = await this.openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put({ key: HANDLE_KEY, handle });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private openHandleDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('csi-nora-kv', 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('kv')) {
          db.createObjectStore('kv', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
  }

  private readHandle(db: IDBDatabase): Promise<FileSystemDirectoryHandle | null> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction('handles', 'readonly');
      const r = tx.objectStore('handles').get(HANDLE_KEY);
      r.onsuccess = () => {
        const row = r.result as { handle?: FileSystemDirectoryHandle } | undefined;
        resolve(row?.handle ?? null);
      };
      r.onerror = () => reject(r.error);
    });
  }
}
