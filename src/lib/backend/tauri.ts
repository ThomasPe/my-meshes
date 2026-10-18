import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Backend } from './index';
import type { LibraryChanged, ScanProgress } from '@/lib/types';

export function createTauriBackend(): Backend {
  return {
    kind: 'tauri',
    appInfo: () => invoke('app_info'),
    getRoots: () => invoke('get_roots'),
    addRoot: (path, mode) => invoke('add_root', { path, mode }),
    removeRoot: (id) => invoke('remove_root', { id }),
    setRootMode: (id, mode, pollIntervalSecs) => invoke('set_root_mode', { id, mode, pollIntervalSecs }),
    scanRoot: (id) => invoke('scan_root', { id }),
    listProjects: (query) => invoke('list_projects', { query }),
    getProject: (id) => invoke('get_project', { id }),
    tagCounts: (rootId) => invoke('tag_counts', { rootId: rootId ?? null }),
    folderTree: (rootId) => invoke('folder_tree', { rootId }),
    libraryStats: (rootId) => invoke('library_stats', { rootId: rootId ?? null }),
    readProjectFile: (projectId, relPath) => invoke<ArrayBuffer>('read_project_file', { projectId, relPath }),
    updateMetadata: (projectId, update) => invoke('update_metadata', { projectId, update }),
    revealProject: (projectId) => invoke('reveal_project', { projectId }),
    openProjectFile: (projectId, relPath) => invoke('open_project_file', { projectId, relPath }),
    pickFolder: () => invoke('pick_folder'),
    getIgnorePatterns: () => invoke('get_ignore_patterns'),
    setIgnorePatterns: (patterns) => invoke('set_ignore_patterns', { patterns }),
    setFavorite: (projectId, favorite) => invoke('set_favorite', { projectId, favorite }),
    renameProject: (projectId, newName) => invoke('rename_project', { projectId, newName }),
    deleteProject: (projectId) => invoke('delete_project', { projectId }),
    deleteFile: (projectId, relPath) => invoke('delete_file', { projectId, relPath }),
    thumbQueue: (limit) => invoke('thumb_queue', { limit: limit ?? null }),
    thumbStats: () => invoke('thumb_stats'),
    // raw body (no JSON, no base64); the id rides in an ASCII-safe header
    storeThumbnail: (projectId, png) => invoke<string>('store_thumbnail', new Uint8Array(png), { headers: { 'x-project-id': encodeURIComponent(projectId) } }),
    storeEmbeddedThumbnail: (projectId) => invoke('store_embedded_thumbnail', { projectId }),
    thumbnailFailed: (projectId, reason) => invoke('thumbnail_failed', { projectId, reason }),
    readThumbnail: (key) => invoke<ArrayBuffer>('read_thumbnail', { key }),
    clearThumbnails: () => invoke('clear_thumbnails'),
    onScanProgress: (cb) => listen<ScanProgress>('scan://progress', (e) => cb(e.payload)),
    onLibraryChanged: (cb) => listen<LibraryChanged>('library://changed', (e) => cb(e.payload)),
    onProjectChanged: (cb) => listen<{ projectId: string }>('project://changed', (e) => cb(e.payload)),
  };
}
