/** CDN ESM import for Transformers.js (runtime-only; not bundled). */
declare module 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1' {
  export const pipeline: (
    task: string,
    model?: string,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
  export const env: {
    allowLocalModels: boolean;
    useBrowserCache: boolean;
  };
}

/** File System Access API — permission helpers (Chromium). */
interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemDirectoryHandle {
  queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}
