export type ApiProvider   = 'anthropic' | 'openai' | 'hf' | 'ollama';
export type Sensitivity   = 'public' | 'internal' | 'confidential';
export type UserRole      = 'engineer' | 'support' | 'sales' | 'manager' | 'executive';
export type HybridMode    = 'hybrid' | 'local' | 'checking';
export type RagMode       = 'hybrid' | 'dense' | 'sparse' | 'off';
export type EmbedStatus   = 'idle' | 'loading' | 'ready' | 'error';
export type AccelDevice   = 'auto' | 'cpu' | 'gpu' | 'npu';

export interface ChatMessage {
  id:          string;
  role:        'nora' | 'user';
  content:     string;
  docSources?: string[];
  apiMode?:    HybridMode;
  ragChunks?:  RetrievedChunk[];
  timestamp:   string;
  /** True when bridge output guardrails redacted or blocked content (Responsible AI). */
  guarded?:    boolean;
  guardReason?: string;
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
  /** OpenAI-compatible base URL (used by openai + ollama) */
  baseUrls:  Partial<Record<ApiProvider, string>>;
  /** Compute preference when talking to local sandbox */
  accelDevice: AccelDevice;
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
  pct: number; lastSaved: string | null;
}
