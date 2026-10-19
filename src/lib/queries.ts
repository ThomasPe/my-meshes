import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { getBackend } from '@/lib/backend';
import { kickThumbQueue, useThumbs } from '@/lib/thumbs/queue';
import type { BatchUpdate, ImportRequest, ListQuery, Project, ProjectSummary, ThumbLocation, UpdateMetadata } from '@/lib/types';

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: false, refetchOnWindowFocus: false } } });

export const keys = {
  appInfo: ['appInfo'] as const,
  roots: ['roots'] as const,
  projects: (q: ListQuery) => ['projects', q] as const,
  project: (id: string) => ['project', id] as const,
  tags: (rootId: string | null) => ['tags', rootId] as const,
  facets: (rootId: string | null) => ['facets', rootId] as const,
  thumbLocation: ['thumbLocation'] as const,
  tree: (rootId: string) => ['tree', rootId] as const,
  stats: ['stats'] as const,
  ignore: ['ignore'] as const,
  thumbStats: ['thumbStats'] as const,
  containers: ['containers'] as const,
  collections: ['collections'] as const,
  smart: ['smart'] as const,
  smartProjects: (id: string, q: ListQuery) => ['smartProjects', id, q] as const,
  inbox: (rootId: string) => ['inbox', rootId] as const,
};

export const useAppInfo = () => useQuery({ queryKey: keys.appInfo, queryFn: async () => (await getBackend()).appInfo(), staleTime: Infinity });
export const useRoots = () => useQuery({ queryKey: keys.roots, queryFn: async () => (await getBackend()).getRoots() });
export const useProjects = (q: ListQuery) => useQuery({ queryKey: keys.projects(q), queryFn: async () => (await getBackend()).listProjects(q), placeholderData: (prev) => prev });
export const useProject = (id: string | null) => useQuery({ queryKey: keys.project(id ?? ''), queryFn: async () => (await getBackend()).getProject(id!), enabled: !!id });
export const useTagCounts = (rootId: string | null = null) => useQuery({ queryKey: keys.tags(rootId), queryFn: async () => (await getBackend()).tagCounts(rootId) });
export const useFacets = (rootId: string | null = null) => useQuery({ queryKey: keys.facets(rootId), queryFn: async () => (await getBackend()).facets(rootId) });
export const useThumbLocation = () => useQuery({ queryKey: keys.thumbLocation, queryFn: async () => (await getBackend()).getThumbLocation() });
export const useFolderTree = (rootId: string) => useQuery({ queryKey: keys.tree(rootId), queryFn: async () => (await getBackend()).folderTree(rootId) });
export const useLibraryStats = () => useQuery({ queryKey: keys.stats, queryFn: async () => (await getBackend()).libraryStats() });
export const useIgnorePatterns = () => useQuery({ queryKey: keys.ignore, queryFn: async () => (await getBackend()).getIgnorePatterns() });
export const useContainerDirs = () => useQuery({ queryKey: keys.containers, queryFn: async () => (await getBackend()).getContainerDirs() });

export function invalidateLibrary(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['projects'] });
  qc.invalidateQueries({ queryKey: ['smartProjects'] });
  qc.invalidateQueries({ queryKey: ['inbox'] });
  qc.invalidateQueries({ queryKey: ['tags'] });
  qc.invalidateQueries({ queryKey: ['facets'] });
  qc.invalidateQueries({ queryKey: ['tree'] });
  qc.invalidateQueries({ queryKey: keys.stats });
  qc.invalidateQueries({ queryKey: keys.roots });
  qc.invalidateQueries({ queryKey: keys.thumbStats });
}

/** Patches one project in every cached list and detail query (favorite toggles, thumbnails). */
export function patchProject(qc: QueryClient, id: string, patch: Partial<ProjectSummary> & Partial<Project>) {
  qc.setQueriesData<ProjectSummary[]>({ queryKey: ['projects'] }, (list) => list?.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  qc.setQueryData<Project>(keys.project(id), (p) => (p ? { ...p, ...patch } : p));
}

/** Subscribes once to backend events and keeps the query cache fresh. */
export function useBackendEvents(onScan?: (rootId: string, found: number) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    let dead = false;
    const unlisten: Array<() => void> = [];
    let flush: ReturnType<typeof setTimeout> | null = null;
    getBackend().then(async (b) => {
      const a = await b.onLibraryChanged((e) => {
        invalidateLibrary(qc);
        if (e.reason === 'rename' && e.oldId) qc.removeQueries({ queryKey: keys.project(e.oldId) });
        if (e.reason === 'delete' && e.oldId) qc.removeQueries({ queryKey: keys.project(e.oldId) });
        if (e.reason === 'thumbs_cleared') useThumbs.setState({ fresh: {} });
        void kickThumbQueue();
      });
      const c = await b.onProjectChanged((e) => { qc.invalidateQueries({ queryKey: keys.project(e.projectId) }); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['tags'] }); qc.invalidateQueries({ queryKey: ['facets'] }); qc.invalidateQueries({ queryKey: keys.stats }); void kickThumbQueue(); });
      const s = await b.onScanProgress((p) => onScan?.(p.root_id, p.projects_found));
      const d = await b.onCollectionsChanged(() => { qc.invalidateQueries({ queryKey: keys.collections }); qc.invalidateQueries({ queryKey: keys.smart }); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['smartProjects'] }); });
      const i = await b.onInboxChanged((e) => { qc.invalidateQueries({ queryKey: keys.inbox(e.rootId) }); });
      const w = await b.onWatchError((e) => { qc.invalidateQueries({ queryKey: keys.roots }); toast.warning(i18n.t('status.watchError'), { description: e.message, duration: 12_000 }); });
      if (dead) { a(); c(); s(); d(); i(); w(); } else unlisten.push(a, c, s, d, i, w);
    });
    // Thumbnails: patch cards as PNGs land, and refetch lists once a batch settles.
    import('@/lib/thumbs/queue').then(({ startThumbnails }) => {
      if (dead) return;
      startThumbnails((projectId, key) => {
        patchProject(qc, projectId, { thumb: key });
        if (flush) clearTimeout(flush);
        flush = setTimeout(() => { qc.invalidateQueries({ queryKey: keys.thumbStats }); }, 800);
      });
    });
    return () => { dead = true; unlisten.forEach((u) => u()); if (flush) clearTimeout(flush); };
  }, [qc, onScan]);
}

/** META-6: one metadata change for a multi-selection; the backend emits per-project events. */
export function useBatchUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, update }: { ids: string[]; update: BatchUpdate }) => (await getBackend()).batchUpdateMetadata(ids, update),
    onSettled: () => { qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['project'] }); qc.invalidateQueries({ queryKey: ['tags'] }); qc.invalidateQueries({ queryKey: ['facets'] }); qc.invalidateQueries({ queryKey: ['smartProjects'] }); },
  });
}

export function useSetThumbLocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (location: ThumbLocation) => (await getBackend()).setThumbLocation(location),
    onSuccess: (l) => qc.setQueryData(keys.thumbLocation, l),
  });
}

/** Favorite toggle, optimistic in every list. */
export function useSetFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, favorite }: { id: string; favorite: boolean }) => (await getBackend()).setFavorite(id, favorite),
    onMutate: ({ id, favorite }) => { patchProject(qc, id, { favorite }); },
    onError: (_e, { id, favorite }) => { patchProject(qc, id, { favorite: !favorite }); },
    onSettled: () => { qc.invalidateQueries({ queryKey: keys.stats }); },
  });
}

export function useRenameProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => (await getBackend()).renameProject(id, name),
    onSuccess: (project, { id }) => { qc.removeQueries({ queryKey: keys.project(id) }); qc.setQueryData(keys.project(project.id), project); invalidateLibrary(qc); },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => (await getBackend()).deleteProject(id),
    onSuccess: (_r, id) => { qc.removeQueries({ queryKey: keys.project(id) }); invalidateLibrary(qc); },
  });
}

export function useDeleteFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, relPath }: { id: string; relPath: string }) => (await getBackend()).deleteFile(id, relPath),
    onSuccess: (project, { id }) => { if (project) qc.setQueryData(keys.project(id), project); else qc.removeQueries({ queryKey: keys.project(id) }); invalidateLibrary(qc); },
  });
}

export const useThumbStats = () => useQuery({ queryKey: keys.thumbStats, queryFn: async () => (await getBackend()).thumbStats(), refetchInterval: (q) => ((q.state.data?.pending ?? 0) > 0 ? 3000 : false) });

/** Optimistic metadata update: the list and the project reflect the change at once; on failure the cache rolls back. */
export function useUpdateMetadata() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, update }: { id: string; update: UpdateMetadata }) => (await getBackend()).updateMetadata(id, update),
    onMutate: async ({ id, update }) => {
      await qc.cancelQueries({ queryKey: keys.project(id) });
      const prev = qc.getQueryData<Project>(keys.project(id));
      if (prev) qc.setQueryData<Project>(keys.project(id), { ...prev, tags: update.tags ?? prev.tags, title: update.title ?? prev.title, creator: update.creator ?? prev.creator });
      return { prev };
    },
    onError: (_e, { id }, ctx) => { if (ctx?.prev) qc.setQueryData(keys.project(id), ctx.prev); },
    onSuccess: (project) => { qc.setQueryData(keys.project(project.id), project); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['tags'] }); },
  });
}

// ---- D3: collections, smart collections, inbox, import ----------------------------------

export const useCollections = () => useQuery({ queryKey: keys.collections, queryFn: async () => (await getBackend()).getCollections() });
export const useSmartCollections = () => useQuery({ queryKey: keys.smart, queryFn: async () => (await getBackend()).getSmartCollections() });
export const useSmartProjects = (id: string | null, overrides: ListQuery) => useQuery({ queryKey: keys.smartProjects(id ?? '', overrides), queryFn: async () => (await getBackend()).listSmartCollection(id!, overrides), enabled: !!id, placeholderData: (prev) => prev });
export const useInbox = (rootId: string | null) => useQuery({ queryKey: keys.inbox(rootId ?? ''), queryFn: async () => (await getBackend()).listInbox(rootId!), enabled: !!rootId });

function useCollectionMutation<TArgs, TOut>(fn: (b: Awaited<ReturnType<typeof getBackend>>, args: TArgs) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => fn(await getBackend(), args),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.collections }); qc.invalidateQueries({ queryKey: keys.smart }); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['smartProjects'] }); },
  });
}
export const useCreateCollection = () => useCollectionMutation((b, name: string) => b.createCollection(name));
export const useRenameCollection = () => useCollectionMutation((b, a: { id: string; name: string }) => b.renameCollection(a.id, a.name));
export const useDeleteCollection = () => useCollectionMutation((b, id: string) => b.deleteCollection(id));
export const useAddToCollection = () => useCollectionMutation((b, a: { id: string; projectIds: string[] }) => b.addToCollection(a.id, a.projectIds));
export const useRemoveFromCollection = () => useCollectionMutation((b, a: { id: string; projectIds: string[] }) => b.removeFromCollection(a.id, a.projectIds));
export const useReorderCollection = () => useCollectionMutation((b, a: { id: string; order: string[] }) => b.reorderCollection(a.id, a.order));
export const useCreateSmartCollection = () => useCollectionMutation((b, a: { name: string; query: ListQuery }) => b.createSmartCollection(a.name, a.query));
export const useRenameSmartCollection = () => useCollectionMutation((b, a: { id: string; name: string }) => b.updateSmartCollection(a.id, a.name));
export const useDeleteSmartCollection = () => useCollectionMutation((b, id: string) => b.deleteSmartCollection(id));

export function usePromoteInbox() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { rootId: string; files: string[]; name: string }) => (await getBackend()).promoteInbox(a.rootId, a.files, a.name),
    onSuccess: (project) => { qc.setQueryData(keys.project(project.id), project); invalidateLibrary(qc); },
  });
}
export function useDeleteInboxFile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { rootId: string; name: string }) => (await getBackend()).deleteInboxFile(a.rootId, a.name),
    onSuccess: (_r, a) => { qc.invalidateQueries({ queryKey: keys.inbox(a.rootId) }); },
  });
}
export function useExecuteImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (request: ImportRequest) => (await getBackend()).executeImport(request),
    onSuccess: () => invalidateLibrary(qc),
  });
}
