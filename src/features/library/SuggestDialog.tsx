import { Loader2, Settings as SettingsIcon, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { reportError } from '@/lib/errors';
import { keys, useSuggestMetadata, useUpdateMetadata } from '@/lib/queries';
import { navigate } from '@/lib/router';
import { isAppError, type MetadataSuggestion, type Project, type UpdateMetadata } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

type Field = 'title' | 'creator' | 'license' | 'description' | 'tags';
const FIELDS: Field[] = ['title', 'creator', 'license', 'description', 'tags'];

/**
 * AI metadata suggestion (ADR-0003, Epic 9): asks the backend for a suggestion, shows it next
 * to the current values with a checkbox per field, and writes the ticked fields through the
 * normal sidecar save with the stamp the project was read with. Nothing is written otherwise.
 */
export function SuggestDialog({ project: p, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const suggest = useSuggestMetadata();
  const update = useUpdateMetadata();
  const [picked, setPicked] = useState<Record<Field, boolean>>({ title: true, creator: true, license: true, description: true, tags: true });
  const [conflict, setConflict] = useState<UpdateMetadata | null>(null);
  const s = suggest.data;
  const setup = suggest.isError && isAppError(suggest.error) && suggest.error.code === 'ai_disabled';

  useEffect(() => {
    if (open) { suggest.reset(); setConflict(null); suggest.mutate(p.id); }
  }, [open, p.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // a field is offered when the model proposed something that differs from what the project has
  const offered = useMemo(() => {
    if (!s) return [] as Field[];
    const differs: Record<Field, boolean> = {
      title: !!s.title && s.title !== p.title,
      creator: !!s.creator && s.creator !== (p.creator ?? ''),
      license: !!s.license && s.license !== (p.license ?? ''),
      description: !!s.description && s.description !== (p.description ?? ''),
      tags: s.tags.length > 0 && s.tags.some((x) => !p.tags.includes(x)),
    };
    return FIELDS.filter((f) => differs[f]);
  }, [s, p]);

  const build = (force: boolean): UpdateMetadata => {
    const u: UpdateMetadata = { expected_stamp: p.sidecar_stamp ?? null, force };
    if (!s) return u;
    if (picked.title && offered.includes('title')) u.title = s.title!;
    if (picked.creator && offered.includes('creator')) u.creator = s.creator!;
    if (picked.license && offered.includes('license')) u.license = s.license!;
    if (picked.description && offered.includes('description')) u.description = s.description!;
    if (picked.tags && offered.includes('tags')) u.tags = [...new Set([...p.tags, ...s.tags])];
    return u;
  };
  const apply = (force = false) => {
    const u = build(force);
    update.mutate({ id: p.id, update: u }, {
      onSuccess: (np) => { setConflict(null); toast.success(t('inspector.suggestApplied'), { description: np.title }); onOpenChange(false); },
      onError: (e) => { if (isAppError(e) && e.code === 'sidecar_conflict') setConflict(u); else reportError(e); },
    });
  };
  const reload = () => { setConflict(null); void qc.invalidateQueries({ queryKey: keys.project(p.id) }); };
  const anyPicked = offered.some((f) => picked[f]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="suggest-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" />{t('inspector.suggestTitle')}</DialogTitle>
          <DialogDescription>{t('inspector.suggestBody')}</DialogDescription>
        </DialogHeader>

        {suggest.isPending && <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" data-testid="suggest-loading"><Loader2 className="size-4 animate-spin" />{t('inspector.suggestLoading')}</div>}

        {setup && (
          <div className="grid gap-3 rounded-[10px] bg-accent p-3 text-sm text-accent-foreground" data-testid="suggest-setup">
            {t('inspector.suggestSetup')}
            <div><Button size="sm" variant="outline" onClick={() => { onOpenChange(false); navigate({ page: 'settings' }); }} data-testid="suggest-open-settings"><SettingsIcon />{t('inspector.suggestOpenSettings')}</Button></div>
          </div>
        )}
        {suggest.isError && !setup && (
          <div className="grid gap-3 rounded-[10px] bg-warning-soft p-3 text-sm text-warning" data-testid="suggest-error">
            {isAppError(suggest.error) ? t(`errors.${suggest.error.code}`, { defaultValue: suggest.error.message, message: suggest.error.message }) : String(suggest.error)}
            <div><Button size="sm" variant="outline" onClick={() => suggest.mutate(p.id)} data-testid="suggest-retry">{t('inspector.suggestRetry')}</Button></div>
          </div>
        )}

        {s && (
          <div className="grid gap-3">
            {offered.length === 0 && <p className="text-sm text-muted-foreground" data-testid="suggest-nothing">{t('inspector.suggestNothing')}</p>}
            <ul className="grid gap-2">
              {offered.map((f) => (
                <li key={f} className={cn('grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 rounded-[10px] bg-background p-3', !picked[f] && 'opacity-60')} data-testid="suggest-field" data-field={f}>
                  <input type="checkbox" className="mt-1 size-4 accent-primary" checked={picked[f]} onChange={(e) => setPicked((x) => ({ ...x, [f]: e.target.checked }))} aria-label={t(`inspector.suggestField.${f}`)} data-testid={`suggest-pick-${f}`} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t(`inspector.suggestField.${f}`)}</div>
                    {f === 'tags' ? (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {s.tags.map((tag) => <span key={tag} className={cn('inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold', p.tags.includes(tag) && 'text-muted-foreground')} data-testid="suggest-tag">{tag}{s.new_tags.includes(tag) && <Badge variant="accent" className="px-1.5 py-0 text-[10px]" data-testid="suggest-tag-new">{t('inspector.suggestNew')}</Badge>}</span>)}
                      </div>
                    ) : (
                      <>
                        <div className="text-[13px] font-semibold" data-testid="suggest-value">{s[f]}</div>
                        {current(p, f) && <div className="truncate text-xs text-muted-foreground"><span className="font-semibold">{t('inspector.suggestCurrent')}:</span> {current(p, f)}</div>}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="text-xs text-muted-foreground" data-testid="suggest-meta">
              {t('inspector.suggestModel', { model: s.model })}{s.cached && <> · <span data-testid="suggest-cached">{t('inspector.suggestCached')}</span></>}
              <br />
              {t('inspector.suggestSent', { items: sentItems(s, t).join(', ') })}
            </div>
          </div>
        )}

        {conflict && (
          <div className="grid gap-2 rounded-[10px] bg-warning-soft p-3 text-sm text-warning" data-testid="suggest-conflict">
            {t('inspector.suggestConflict')}
            <div className="flex gap-2"><Button size="sm" variant="outline" onClick={reload}>{t('inspector.suggestReload')}</Button><Button size="sm" variant="destructive" onClick={() => apply(true)}>{t('inspector.suggestOverwrite')}</Button></div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
          <Button disabled={!s || !anyPicked || update.isPending || p.offline} onClick={() => apply()} data-testid="suggest-apply">{update.isPending ? <Loader2 className="animate-spin" /> : <Sparkles />}{t('inspector.suggestApply')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function current(p: Project, f: Exclude<Field, 'tags'>): string {
  return (f === 'title' ? p.title : p[f]) ?? '';
}

function sentItems(s: MetadataSuggestion, t: (k: string, o?: Record<string, unknown>) => string): string[] {
  const items: string[] = [];
  if (s.sent.thumbnail) items.push(t('inspector.suggestSentThumbnail'));
  items.push(t('inspector.suggestSentFiles', { count: s.sent.files }));
  items.push(...s.sent.documents);
  if (s.sent.sidecar) items.push(t('inspector.suggestSentSidecar'));
  return items;
}
