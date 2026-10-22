// Hand-mirrored from crates/engine/src/model.rs and src-tauri/src/commands.rs.
// Keep field names identical to the Rust side (serde default, snake_case).

export type SyncMode = 'watch' | 'poll' | 'manual';
export type RootStatus = 'online' | 'offline' | 'unknown';
export type FileKind = 'model' | 'image' | 'document' | 'attachment' | 'other';
export type SortKey = 'modified' | 'title' | 'creator' | 'size' | 'added' | 'collection';
export type ThumbSource = 'render' | 'image' | 'embedded';

export interface LibraryRoot {
  id: string;
  path: string;
  mode: SyncMode;
  poll_interval_secs: number;
  added_at: string;
  last_scan_at: string | null;
  status: RootStatus;
  last_scan: ScanSummary | null;
  last_error: string | null;
}

export interface ScanSummary {
  projects: number;
  files: number;
  ignored: number;
  warnings: string[];
  warning_count: number;
  millis: number;
  trigger: string;
}

export interface FileEntry {
  rel_path: string;
  name: string;
  kind: FileKind;
  size: number;
  modified: string;
  slicer: string | null;
  embedded_thumbnail: boolean;
}

export type SidecarState = { state: 'missing' } | { state: 'ok' } | { state: 'malformed'; message: string };

export interface SidecarStamp {
  /** Nanoseconds as a decimal string: too large for a JavaScript number. */
  mtime_unix_nanos: string;
  size: number;
}

export interface Project {
  id: string;
  root_id: string;
  rel_path: string;
  title: string;
  creator: string | null;
  license: string | null;
  source_url: string | null;
  description: string | null;
  tags: string[];
  material: string | null;
  supports_required: boolean | null;
  thumbnail: string | null;
  files: FileEntry[];
  total_bytes: number;
  model_count: number;
  modified: string;
  sidecar: SidecarState;
  sidecar_stamp: SidecarStamp | null;
  warnings: string[];
  offline: boolean;
  favorite: boolean;
  added: string;
  thumb: string | null;
  slicer: string | null;
}

export interface ProjectSummary {
  id: string;
  root_id: string;
  rel_path: string;
  title: string;
  creator: string | null;
  tags: string[];
  thumbnail: string | null;
  file_count: number;
  model_count: number;
  total_bytes: number;
  modified: string;
  has_sidecar: boolean;
  offline: boolean;
  favorite: boolean;
  added: string;
  thumb: string | null;
  slicer: string | null;
}

export interface ListQuery {
  root_id?: string | null;
  path_prefix?: string | null;
  tags?: string[];
  text?: string | null;
  favorites?: boolean;
  collection_id?: string | null;
  creator?: string | null;
  license?: string | null;
  material?: string | null;
  /** Model file extension without the dot (`stl`, `3mf`, ...). */
  file_type?: string | null;
  sort?: SortKey;
  limit?: number | null;
  offset?: number | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface FacetCount {
  value: string;
  count: number;
}

export interface Facets {
  creators: FacetCount[];
  licenses: FacetCount[];
  materials: FacetCount[];
  file_types: FacetCount[];
}

export type ThumbLocation = 'app_data' | 'project';

export interface BatchUpdate {
  add_tags?: string[];
  remove_tags?: string[];
  creator?: string;
  license?: string;
}

export interface HashProgress { done: number; total: number }
export type DuplicateKind = 'identical' | 'overlap';
export interface DuplicateMember extends ProjectSummary { shared_files: number; model_files: number }
export interface DuplicateGroup { kind: DuplicateKind; files: number; bytes: number; members: DuplicateMember[] }
export interface DuplicateReport { groups: DuplicateGroup[]; candidates: number; hashed: number }
export interface MoveReport { moved: Project[]; failed: Array<{ project_id: string; message: string }> }
export interface PromoteItem { file: string; name: string }
export interface PromoteReport { created: Project[]; failed: Array<{ file: string; message: string }> }

export interface BatchReport {
  updated: number;
  failed: Array<{ project_id: string; message: string }>;
}

export interface FolderNode {
  name: string;
  rel_path: string;
  project_count: number;
  /** The folder is a project itself, not only a container of projects. */
  is_project: boolean;
  children: FolderNode[];
}

export interface ScanReport {
  root_id: string;
  projects: number;
  files: number;
  ignored: number;
  warnings: string[];
  millis: number;
}

export interface ScanProgress {
  root_id: string;
  projects_found: number;
}

export interface UpdateMetadata {
  title?: string;
  creator?: string;
  license?: string;
  source_url?: string;
  description?: string;
  tags?: string[];
  recommended_material?: string;
  supports_required?: boolean;
  notes?: string;
  expected_stamp?: SidecarStamp | null;
  force?: boolean;
}

export interface AppInfo {
  version: string;
  dataDir: string;
  testMode: boolean;
  e2eBuild: boolean;
  updater: boolean;
  store: boolean;
  channel: string | null;
  os: string;
  arch: string;
  webview: string;
  osVersion: string;
}

export interface LibraryStats {
  projects: number;
  totalBytes: number;
  favorites: number;
}

export interface Collection {
  id: string;
  name: string;
  projects: string[];
}

export interface SmartCollection {
  id: string;
  name: string;
  query: ListQuery;
}

export type SourceKind = 'archive' | 'folder' | 'file';
export type ImportAction = 'project' | 'inbox' | 'skip';
export type ArchivePolicy = 'keep' | 'originals' | 'trash' | 'leave';

export interface ImportItem {
  source: string;
  kind: SourceKind;
  name: string;
  action: ImportAction;
  model_count: number;
  file_count: number;
  total_bytes: number;
  strip_prefix: string | null;
  warnings: string[];
}

export interface ImportRequest {
  root_id: string;
  items: Array<{ source: string; action: ImportAction; name: string }>;
  archive_policy: ArchivePolicy;
}

export interface ImportReport {
  root_id: string;
  projects: string[];
  inbox_files: number;
  skipped: number;
  errors: string[];
}

export interface ImportProgress {
  index: number;
  total: number;
  name: string;
}

export interface InboxFile {
  name: string;
  kind: FileKind;
  size: number;
  modified: string;
}

export interface ThumbJob {
  project_id: string;
  rel_path: string;
  source: ThumbSource;
}

export interface UpdateInfo {
  available: boolean;
  version: string | null;
  notes: string | null;
  date: string | null;
}

export interface ThumbStats {
  pending: number;
  done: number;
  failed: number;
}

export interface AppError {
  code: 'sidecar_conflict' | 'sidecar_invalid' | 'root_offline' | 'not_found' | 'root_exists' | 'not_a_directory' | 'invalid_pattern' | 'invalid_name' | 'already_exists' | 'not_allowed' | 'io' | 'index' | 'serde' | 'watch' | 'shell' | 'updater' | 'mock';
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

export type LibraryChanged = { rootId: string | null; report: ScanReport | null; reason: 'scan' | 'watch' | 'poll' | 'root_removed' | 'rename' | 'delete' | 'thumbs_cleared' | 'import' | 'move'; error?: string; oldId?: string; newId?: string; oldIds?: string[] };
