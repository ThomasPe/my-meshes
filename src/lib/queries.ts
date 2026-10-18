import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { getBackend } from '@/lib/backend';
import type { ListQuery, Project, UpdateMetadata } from '@/lib/types';

export const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: false, refetchOnWindowFocus: false } } });

export const keys = {
  appInfo: ['appInfo'] as const,
  roots: ['roots'] as const,
  projects: (q: ListQuery) => ['projects', q] as const,
  project: (id: string) => ['project', id] as const,
  tags: (rootId: string | null) => ['tags', rootId] as const,
  tree: (rootId: string) => ['tree', rootId] as const,
  stats: ['stats'] as const,
  ignore: ['ignore'] as const,
};

export const useAppInfo = () => useQuery({ queryKey: keys.appInfo, queryFn: async () => (await getBackend()).appInfo(), staleTime: Infinity });
export const useRoots = () => useQuery({ queryKey: keys.roots, queryFn: async () => (await getBackend()).getRoots() });
export const useProjects = (q: ListQuery) => useQuery({ queryKey: keys.projects(q), queryFn: async () => (await getBackend()).listProjects(q), placeholderData: (prev) => prev });
export const useProject = (id: string | null) => useQuery({ queryKey: keys.project(id ?? ''), queryFn: async () => (await getBackend()).getProject(id!), enabled: !!id });
export const useTagCounts = (rootId: string | null = null) => useQuery({ queryKey: keys.tags(rootId), queryFn: async () => (await getBackend()).tagCounts(rootId) });
export const useFolderTree = (rootId: string) => useQuery({ queryKey: keys.tree(rootId), queryFn: async () => (await getBackend()).folderTree(rootId) });
export const useLibraryStats = () => useQuery({ queryKey: keys.stats, queryFn: async () => (await getBackend()).libraryStats() });
export const useIgnorePatterns = () => useQuery({ queryKey: keys.ignore, queryFn: async () => (await getBackend()).getIgnorePatterns() });

export function invalidateLibrary(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['projects'] });
  qc.invalidateQueries({ queryKey: ['tags'] });
  qc.invalidateQueries({ queryKey: ['tree'] });
  qc.invalidateQueries({ queryKey: keys.stats });
  qc.invalidateQueries({ queryKey: keys.roots });
}

/** Subscribes once to backend events and keeps the query cache fresh. */
export function useBackendEvents(onScan?: (rootId: string, found: number) => void) {
  const qc = useQueryClient();
  useEffect(() => {
    let dead = false;
    const unlisten: Array<() => void> = [];
    getBackend().then(async (b) => {
      const a = await b.onLibraryChanged(() => invalidateLibrary(qc));
      const c = await b.onProjectChanged((e) => { qc.invalidateQueries({ queryKey: keys.project(e.projectId) }); qc.invalidateQueries({ queryKey: ['projects'] }); qc.invalidateQueries({ queryKey: ['tags'] }); });
      const s = await b.onScanProgress((p) => onScan?.(p.root_id, p.projects_found));
      if (dead) { a(); c(); s(); } else unlisten.push(a, c, s);
    });
    return () => { dead = true; unlisten.forEach((u) => u()); };
  }, [qc, onScan]);
}

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
