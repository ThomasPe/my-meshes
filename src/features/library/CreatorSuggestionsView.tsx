import { Check, Globe, RefreshCw, UserSearch, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Thumb } from '@/features/library/Thumb';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { useBatchUpdate, useCreatorSuggestions, useFetchModelPages, useNetworkSettings, useProjects } from '@/lib/queries';
import type { EnrichProgress } from '@/lib/types';
import { navigate } from '@/lib/router';
import { useUi } from '@/lib/store';
import type { CreatorSuggestion } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Creator suggestions (META-7 stage 1): projects without a creator, grouped by the creator
 * the local hints propose. "Apply all" writes the creator into every project.yaml of the
 * group in one engine call; a project can be dropped from a group (dismissed for good).
 */
export function CreatorSuggestionsView() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useCreatorSuggestions(true);
  const batch = useBatchUpdate();
  const selected = useUi((s) => s.selected);
  const select = useUi((s) => s.select);
  const apply = (g: CreatorSuggestion, ids: string[]) => batch.mutate({ ids, update: { creator: g.creator } }, {
    onSuccess: (r) => {
      if (r.updated) toast.success(t('creators.applied', { count: r.updated, creator: g.creator }));
      if (r.failed.length) toast.warning(t('inspector.batchFailed', { count: r.failed.length }), { description: r.failed[0]!.message });
      qc.invalidateQueries({ queryKey: ['creatorSuggestions'] });
    },
    onError: reportError,
  });
  // stage 2: warm the page cache for every project without a creator, then re-read the hints
  const net = useNetworkSettings();
  const all = useProjects({ root_id: null, path_prefix: null, tags: [], text: null, favorites: false, collection_id: null, creator: null, license: null, material: null, file_type: null, sort: 'modified', limit: null });
  const pages = useFetchModelPages();
  const [progress, setProgress] = useState<EnrichProgress | null>(null);
  useEffect(() => {
    let off: (() => void) | null = null;
    let dead = false;
    getBackend().then(async (b) => { const u = await b.onEnrichProgress((p) => setProgress(p)); if (dead) u(); else off = u; });
    return () => { dead = true; off?.(); };
  }, []);
  const fetchAll = () => {
    const ids = (all.data ?? []).filter((p) => !p.creator && !p.offline).map((p) => p.id);
    setProgress({ done: 0, total: ids.length });
    pages.mutate(ids, {
      onSuccess: (r) => { toast.success(t('creators.fetched', { fetched: r.fetched, cached: r.cached, noLink: r.no_link })); if (r.failed.length) toast.warning(t('creators.fetchFailed', { count: r.failed.length }), { description: r.failed[0]!.message }); },
      onError: reportError,
      onSettled: () => setProgress(null),
    });
  };
  const dismiss = (id: string, value: string) => getBackend().then((b) => b.dismissCreatorHint(id, value)).then(() => { qc.invalidateQueries({ queryKey: ['creatorSuggestions'] }); qc.invalidateQueries({ queryKey: ['hints', id] }); }).catch(reportError);
  const data = q.data;
  return (
    <div className="h-full overflow-auto px-5 pb-6 pt-3" data-testid="creators">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">{t('creators.hint')}</p>
        {net.data?.fetch_model_pages && <Button size="sm" variant="outline" disabled={pages.isPending || !all.data} onClick={fetchAll} title={t('creators.fetchAllHint')} data-testid="creators-fetch-pages"><Globe className={cn(pages.isPending && 'animate-pulse')} />{progress ? t('creators.fetching', { done: progress.done, total: progress.total }) : t('creators.fetchAll')}</Button>}
        <Button size="sm" variant="outline" disabled={q.isFetching} onClick={() => void q.refetch()} data-testid="creators-refresh"><RefreshCw className={cn(q.isFetching && 'animate-spin')} />{t('creators.refresh')}</Button>
      </div>
      {data && data.groups.length === 0 && (
        <div className="grid place-items-center rounded-2xl bg-card p-10 text-center text-muted-foreground shadow-card" data-testid="creators-empty">
          <div className="grid justify-items-center gap-2"><UserSearch className="size-7" /><b className="text-foreground">{t('creators.none')}</b><p className="max-w-[44ch] text-sm">{t('creators.noneHint', { without: data.without_hint, dismissed: data.dismissed })}</p></div>
        </div>
      )}
      {data && data.groups.length > 0 && <p className="mb-3 text-xs font-semibold text-muted-foreground" data-testid="creators-summary">{t('creators.summary', { groups: data.groups.length, projects: data.groups.reduce((a, g) => a + g.projects.length, 0), without: data.without_hint })}</p>}
      <div className="grid gap-3">
        {data?.groups.map((g) => (
          <section key={g.creator} className="rounded-2xl bg-card p-4 shadow-card" data-testid="creator-group" data-creator={g.creator}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-base font-extrabold tracking-tight">{g.creator}</h3>
              <Badge variant={g.confidence >= 80 ? 'accent' : 'default'}>{t('creators.confidence', { percent: g.confidence })}</Badge>
              <span className="text-sm text-muted-foreground">{t('library.projects', { count: g.projects.length })}</span>
              <Button size="sm" className="ml-auto" disabled={batch.isPending} onClick={() => apply(g, g.projects.map((p) => p.id))} data-testid="creator-apply-all"><Check />{t('creators.applyAll', { count: g.projects.length })}</Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {g.projects.map((p) => {
                const sel = selected.includes(p.id);
                return (
                  <div key={p.id} className={cn('flex min-w-0 gap-3 overflow-hidden rounded-xl border-2 border-transparent bg-background p-2.5 outline-none', sel && 'border-primary')} data-testid="creator-project" aria-selected={sel} tabIndex={0} onClick={() => select([p.id])} onDoubleClick={() => navigate({ page: 'project', id: p.id })} onKeyDown={(e) => { if (e.key === 'Enter') navigate({ page: 'project', id: p.id }); }}>
                    <Thumb thumb={p.thumb} projectId={p.id} className="size-16 shrink-0 overflow-hidden rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold" title={p.title}>{p.title}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground" title={p.rel_path}>{p.rel_path || '/'}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{t(`creators.source.${p.source}` as const)} · {p.confidence}%</div>
                      <div className="mt-2 flex gap-1.5">
                        <Button size="sm" variant="outline" className="h-7" disabled={batch.isPending} onClick={(e) => { e.stopPropagation(); apply(g, [p.id]); }} data-testid="creator-apply"><Check />{t('creators.apply')}</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" onClick={(e) => { e.stopPropagation(); void dismiss(p.id, g.creator); }} title={t('creators.dismissHint')} data-testid="creator-dismiss"><X />{t('creators.dismiss')}</Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
