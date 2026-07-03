export type ApiProvider   = 'anthropic' | 'openai' | 'hf';
export type ApiHealthStatus = 'online' | 'offline' | 'unknown';
export type Sensitivity   = 'public' | 'internal' | 'confidential';
export type UserRole      = 'engineer' | 'support' | 'sales' | 'manager' | 'executive';
export type HybridMode    = 'hybrid' | 'local' | 'checking';
export type RagMode       = 'hybrid' | 'dense' | 'sparse' | 'off';
export type EmbedStatus   = 'idle' | 'loading' | 'ready' | 'error';

/** Runtime deployment lane (sandbox vs production builds). */
export type DeploymentTier = 'sandbox' | 'production';

/** Which product experience the user chose from the launcher (persisted). */
export type ProductExperience = 'governance' | 'ask-nora' | 'both' | 'aichatops';

/** Angular `environment` object shape (build-time file replacement). */
export interface AppEnvironment {
  production: boolean;
  deploymentTier: DeploymentTier;
  /** Browser tier override for UAT — always `false` in production builds. */
  allowUatOverride: boolean;
  appVersion: string;
  /**
   * CSI Nora API gateway origin (no trailing slash).
   * Empty string: browser calls model providers directly (keys from API settings UI).
   * Non-empty: requests go to `{backendBaseUrl}/api/llm/...` (see `backend-llm-urls.ts`).
   */
  backendBaseUrl: string;
  /**
   * Prefer the token/gateway backend over direct provider calls in the browser.
   * Production builds should set `true` when using the CSI Nora API gateway; optional YAML can override.
   */
  preferTokenBackend: boolean;
}

export interface ChatMessage {
  id:          string;
  role:        'nora' | 'user';
  content:     string;
  docSources?: string[];
  apiMode?:    HybridMode;
  ragChunks?:  RetrievedChunk[];
  timestamp:   string;
}

/** Saved Q&A pairs for reference (separate from live session transcript). */
export interface ChatHistoryEntry {
  id: string;
  at: string;
  query: string;
  source: string;
  content: string;
  linkedFiles: string[];
}

export interface KbDocument {
  id:          string;
  name:        string;
  type:        string;
  size:        number;
  content:     string;
  sensitivity: Sensitivity;
  uploadedAt:  string;
  chunkCount:  number;
  indexed:     boolean;
}

/** Optional multi-repo / batch corpus shipped under `public/corpus/` (see `corpus-manifest.json`). */
export interface CorpusManifest {
  version?: number;
  bundles: CorpusManifestBundle[];
}

export interface CorpusManifestBundle {
  id: string;
  /** Path under site root, e.g. `/corpus/team-handbook.json` */
  url: string;
  name?: string;
}

export interface CorpusBundleFile {
  documents: CorpusBundleDocument[];
}

export interface CorpusBundleDocument {
  name: string;
  content: string;
  sensitivity?: Sensitivity;
}

export interface TextChunk {
  id:          string;
  docId:       string;
  docName:     string;
  content:     string;
  sensitivity: Sensitivity;
}

export interface RetrievedChunk {
  chunk:       TextChunk;
  denseScore:  number;
  sparseScore: number;
  hybridScore: number;
  rank:        number;
}

export interface RagConfig {
  mode:      RagMode;
  topK:      number;
  chunkSize: number;
  overlap:   number;
  minScore:  number;
}

export interface RagStats {
  totalChunks:    number;
  indexedChunks:  number;
  embedStatus:    EmbedStatus;
  embedProgress:  number;
  lastQueryMs:    number;
  mode:           RagMode;
}

export interface AuditEntry {
  ts:          string;
  time:        string;
  role:        UserRole;
  action:      string;
  detail:      string;
  sensitivity: Sensitivity;
}

export interface ApiConfig {
  provider:  ApiProvider;
  models:    Record<ApiProvider, string>;
  keys:      Record<ApiProvider, string>;
  maxTokens: Record<ApiProvider, number>;
}

export interface NamedSession {
  id:        string;
  name:      string;
  sector:    string | null;
  role:      UserRole;
  msgCount:  number;
  messages:  ChatMessage[];
  docs:      KbDocument[];
  savedAt:   string;
}

export interface SectorSvc  { tag: string; color: string; bg: string; }
export interface Sector {
  name: string; icon: string; desc: string; count: number;
  services: SectorSvc[]; quickPrompts: string[]; context: string;
}

export interface KbChunk { id: string; tags: string[]; title: string; answer: string; }

export interface StorageStats {
  total: number; msgSize: number; docSize: number;
  auditSize: number; nsSize: number; vecSize: number;
  chatRefSize: number;
  pct: number; lastSaved: string | null;
}

/** Active storage tier after hydration (localStorage → IndexedDB → OPFS → external folder). */
export type ExternalStorageTier = 'local' | 'idb' | 'opfs' | 'external';

export interface ExternalStorageStatus {
  tier: ExternalStorageTier;
  opfsAvailable: boolean;
  externalConnected: boolean;
  externalFolderName: string | null;
  /** One-time banner when File System Access API is supported but no folder linked yet. */
  showConnectPrompt: boolean;
}
