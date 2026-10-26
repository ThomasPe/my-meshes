import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { Backend } from './index';
import type { HashProgress, ImportProgress, LibraryChanged, ScanProgress } from '@/lib/types';

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
    facets: (rootId) => invoke('facets', { rootId: rootId ?? null }),
    batchUpdateMetadata: (projectIds, update) => invoke('batch_update_metadata', { projectIds, update }),
    getThumbLocation: () => invoke('get_thumb_location'),
    setThumbLocation: (location) => invoke('set_thumb_location', { location }),
    notify: async (title, body) => {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === 'granted';
      if (!ok) return false;
      sendNotification({ title, body });
      return true;
    },
    folderTree: (rootId) => invoke('folder_tree', { rootId }),
    libraryStats: (rootId) => invoke('library_stats', { rootId: rootId ?? null }),
    readProjectFile: (projectId, relPath) => invoke<ArrayBuffer>('read_project_file', { projectId, relPath }),
    updateMetadata: (projectId, update) => invoke('update_metadata', { projectId, update }),
    revealProject: (projectId) => invoke('reveal_project', { projectId }),
    logTail: (lines) => invoke('log_tail', { lines }),
    openUrl: (url) => invoke('open_url', { url }),
    revealFolder: (rootId, relPath) => invoke('reveal_folder', { rootId, relPath }),
    openProjectFile: (projectId, relPath) => invoke('open_project_file', { projectId, relPath }),
    pickFolder: () => invoke('pick_folder'),
    getIgnorePatterns: () => invoke('get_ignore_patterns'),
    setIgnorePatterns: (patterns) => invoke('set_ignore_patterns', { patterns }),
    getContainerDirs: () => invoke('get_container_dirs'),
    setContainerDirs: (names) => invoke('set_container_dirs', { names }),
    setFavorite: (projectId, favorite) => invoke('set_favorite', { projectId, favorite }),
    renameProject: (projectId, newName) => invoke('rename_project', { projectId, newName }),
    moveProjects: (projectIds, rootId, destRel) => invoke('move_projects', { projectIds, rootId, destRel }),
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
    resetThumbnail: (projectId) => invoke('reset_thumbnail', { projectId }),
    pickImportFiles: () => invoke('pick_import_files'),
    analyzeImport: (paths) => invoke('analyze_import', { paths }),
    executeImport: (request) => invoke('execute_import', { request }),
    listInbox: (rootId) => invoke('list_inbox', { rootId }),
    promoteInbox: (rootId, files, name) => invoke('promote_inbox', { rootId, files, name }),
    promoteInboxEach: (rootId, items) => invoke('promote_inbox_each', { rootId, items }),
    deleteInboxFile: (rootId, name) => invoke('delete_inbox_file', { rootId, name }),
    getCollections: () => invoke('get_collections'),
    createCollection: (name) => invoke('create_collection', { name }),
    renameCollection: (id, name) => invoke('rename_collection', { id, name }),
    deleteCollection: (id) => invoke('delete_collection', { id }),
    addToCollection: (id, projectIds) => invoke('add_to_collection', { id, projectIds }),
    removeFromCollection: (id, projectIds) => invoke('remove_from_collection', { id, projectIds }),
    reorderCollection: (id, order) => invoke('reorder_collection', { id, order }),
    getSmartCollections: () => invoke('get_smart_collections'),
    createSmartCollection: (name, query) => invoke('create_smart_collection', { name, query }),
    updateSmartCollection: (id, name, query) => invoke('update_smart_collection', { id, name: name ?? null, query: query ?? null }),
    deleteSmartCollection: (id) => invoke('delete_smart_collection', { id }),
    listSmartCollection: (id, overrides) => invoke('list_smart_collection', { id, overrides: overrides ?? null }),
    onImportProgress: (cb) => listen<ImportProgress>('import://progress', (e) => cb(e.payload)),
    getNetworkSettings: () => invoke('get_network_settings'),
    setNetworkSettings: (settings) => invoke('set_network_settings', { settings }),
    projectHints: (projectId) => invoke('project_hints', { projectId }),
    creatorSuggestions: () => invoke('creator_suggestions'),
    dismissCreatorHint: (projectId, value) => invoke('dismiss_creator_hint', { projectId, value }),
    findDuplicates: () => invoke('find_duplicates'),
    onDuplicateProgress: (cb) => listen<HashProgress>('duplicates://progress', (e) => cb(e.payload)),
    onCollectionsChanged: (cb) => listen('collections://changed', () => cb()),
    onInboxChanged: (cb) => listen<{ rootId: string }>('inbox://changed', (e) => cb(e.payload)),
    onWatchError: (cb) => listen<{ rootId: string; message: string }>('watch://error', (e) => cb(e.payload)),
    checkUpdate: () => invoke('check_update'),
    installUpdate: () => invoke('install_update'),
    getAiSettings: () => invoke('get_ai_settings'),
    setAiSettings: (settings) => invoke('set_ai_settings', { settings }),
    setAiKey: (key) => invoke('set_ai_key', { key }),
    testAi: () => invoke('test_ai'),
    suggestMetadata: (projectId) => invoke('suggest_metadata', { projectId }),
    onFileDrop: (cb) => getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === 'enter') cb({ type: 'enter', paths: p.paths });
      else if (p.type === 'drop') cb({ type: 'drop', paths: p.paths });
      else if (p.type === 'leave') cb({ type: 'leave', paths: [] });
    }),
    onScanProgress: (cb) => listen<ScanProgress>('scan://progress', (e) => cb(e.payload)),
    onLibraryChanged: (cb) => listen<LibraryChanged>('library://changed', (e) => cb(e.payload)),
    onProjectChanged: (cb) => listen<{ projectId: string }>('project://changed', (e) => cb(e.payload)),
  };
}
