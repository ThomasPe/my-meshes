// VIEW-4: choosing a project's preview. The engine rewrites `thumbnail:` in project.yaml and
// drops the cached PNG; here the stale key is forgotten and the queue is kicked so the card
// shows the new preview as soon as it is rendered.
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { invalidateLibrary, keys } from '@/lib/queries';
import { kickThumbQueue, useThumbs } from '@/lib/thumbs/queue';
import { forgetThumbnail } from '@/lib/thumbs/useThumbnail';
import type { Project } from '@/lib/types';

export function useChooseThumbnail(project: Project) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const apply = async (change: Promise<Project>, message: string) => {
    try {
      const fresh = await change;
      const key = project.thumb ?? useThumbs.getState().fresh[project.id];
      if (key) forgetThumbnail(key);
      useThumbs.setState((s) => { const f = { ...s.fresh }; delete f[project.id]; return { fresh: f }; });
      qc.setQueryData(keys.project(project.id), fresh);
      invalidateLibrary(qc);
      toast.success(message);
      void kickThumbQueue();
    } catch (e) { reportError(e); }
  };
  return {
    /** One of the project's images, or `null` for the automatic choice. */
    useImage: (rel: string | null) => apply(getBackend().then((b) => b.setThumbnailImage(project.id, rel)), rel ? t('project.thumbnailSet') : t('project.thumbnailAuto')),
    /** A PNG captured from the viewer. */
    useView: (png: ArrayBuffer) => apply(getBackend().then((b) => b.setViewThumbnail(project.id, png)), t('project.thumbnailSet')),
  };
}
