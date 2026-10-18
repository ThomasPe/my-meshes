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
    onScanProgress: (cb) => listen<ScanProgress>('scan://progress', (e) => cb(e.payload)),
    onLibraryChanged: (cb) => listen<LibraryChanged>('library://changed', (e) => cb(e.payload)),
    onProjectChanged: (cb) => listen<{ projectId: string }>('project://changed', (e) => cb(e.payload)),
  };
}
