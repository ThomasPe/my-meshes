// Hand-mirrored from crates/engine/src/model.rs and src-tauri/src/commands.rs.
// Keep field names identical to the Rust side (serde default, snake_case).

export type SyncMode = 'watch' | 'poll' | 'manual';
export type RootStatus = 'online' | 'offline' | 'unknown';
export type FileKind = 'model' | 'image' | 'document' | 'attachment' | 'other';
export type SortKey = 'modified' | 'title' | 'creator' | 'size' | 'added';
export type ThumbSource = 'render' | 'image' | 'embedded';

export interface LibraryRoot {
  id: string;
  path: string;
  mode: SyncMode;
  poll_interval_secs: number;
  added_at: string;
  last_scan_at: string | null;
  status: RootStatus;
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
  mtime_unix_nanos: number;
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
  sort?: SortKey;
  limit?: number | null;
  offset?: number | null;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface FolderNode {
  name: string;
  rel_path: string;
  project_count: number;
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
  os: string;
  arch: string;
  webview: string;
}

export interface LibraryStats {
  projects: number;
  totalBytes: number;
  favorites: number;
}

export interface ThumbJob {
  project_id: string;
  rel_path: string;
  source: ThumbSource;
}

export interface ThumbStats {
  pending: number;
  done: number;
  failed: number;
}

export interface AppError {
  code: 'sidecar_conflict' | 'sidecar_invalid' | 'root_offline' | 'not_found' | 'root_exists' | 'not_a_directory' | 'invalid_pattern' | 'invalid_name' | 'already_exists' | 'not_allowed' | 'io' | 'index' | 'serde' | 'watch' | 'shell' | 'mock';
  message: string;
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'code' in e && 'message' in e;
}

export type LibraryChanged = { rootId: string | null; report: ScanReport | null; reason: 'scan' | 'watch' | 'poll' | 'root_removed' | 'rename' | 'delete' | 'thumbs_cleared'; error?: string; oldId?: string; newId?: string };
