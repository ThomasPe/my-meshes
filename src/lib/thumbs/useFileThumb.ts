// React side of the per-file previews (VIEW-8): the engine's listing for one project and
// what a single tile shows. The queue itself lives in `files.ts`.
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { getBackend } from '@/lib/backend';
import { keys } from '@/lib/queries';
import { cancelFileThumbs, canRender, fileStamp, fileThumbId, requestFileThumb, useFileThumbStore } from '@/lib/thumbs/files';
import type { FileEntry, FileThumb } from '@/lib/types';

export interface FileThumbListing {
  /** The engine answered: a file without an entry really has no preview yet. */
  ready: boolean;
  byRel: Map<string, FileThumb>;
}

/** For the page that shows one project: requests still waiting are dropped when it moves on
 * to another project or closes. Tiles coming and going inside the page (tabs) keep theirs. */
export function useFileThumbScope(projectId: string | null) {
  useEffect(() => () => { if (projectId) cancelFileThumbs(projectId); }, [projectId]);
}

/** The engine's cached previews for the models of one project. */
export function useFileThumbListing(projectId: string, enabled = true): FileThumbListing {
  const q = useQuery({ queryKey: keys.fileThumbs(projectId), queryFn: async () => (await getBackend()).fileThumbs(projectId), enabled: enabled && !!projectId });
  return useMemo(() => ({ ready: q.isSuccess || q.isError, byRel: new Map((q.data ?? []).map((t) => [t.rel_path, t])) }), [q.data, q.isSuccess, q.isError]);
}

export type FileThumbState = 'ready' | 'pending' | 'failed' | 'none';

/** What a tile shows for one model file. With `want`, a missing preview is requested. */
export function useFileThumb(projectId: string, file: FileEntry, listing: FileThumbListing, want: boolean): { key: string | null; rev: number; state: FileThumbState } {
  const entry = useFileThumbStore((s) => s.entries[fileThumbId(projectId, file.rel_path)]);
  const stamp = fileStamp(file);
  const fresh = entry && entry.stamp === stamp ? entry : undefined;
  const known = listing.byRel.get(file.rel_path);
  const key = fresh?.key ?? known?.key ?? null;
  const failed = !key && !!(fresh?.failed || known?.failed);
  const renderable = canRender(file.name);
  const need = want && listing.ready && renderable && !key && !failed;
  useEffect(() => {
    if (need) requestFileThumb(projectId, file);
    // the file is identified by path and state; the object changes with every refetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [need, projectId, file.rel_path, stamp]);
  return { key, rev: fresh?.rev ?? 0, state: key ? 'ready' : failed ? 'failed' : renderable && want ? 'pending' : 'none' };
}
