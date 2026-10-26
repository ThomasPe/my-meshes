import { Check, Lightbulb, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { useProjectHints, useUpdateMetadata } from '@/lib/queries';
import type { Hint, Project, UpdateMetadata } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Local hints for the fields a project leaves empty (META-7 stage 1): one chip per field
 * with the best guess, "apply" writes it to project.yaml, "dismiss" (creator only) is
 * remembered.
 */
export function HintChips({ project: p }: { project: Project }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const wanted = !p.offline && (!p.creator || !p.license || !p.source_url);
  const hints = useProjectHints(p.id, wanted);
  const update = useUpdateMetadata();
  if (!wanted || !hints.data) return null;
  const rows: Array<{ field: 'creator' | 'license' | 'source_url'; hint: Hint }> = [];
  if (!p.creator && hints.data.creator[0]) rows.push({ field: 'creator', hint: hints.data.creator[0] });
  if (!p.license && hints.data.license[0]) rows.push({ field: 'license', hint: hints.data.license[0] });
  if (!p.source_url && hints.data.source_url[0]) rows.push({ field: 'source_url', hint: hints.data.source_url[0] });
  if (rows.length === 0) return null;
  const apply = (field: 'creator' | 'license' | 'source_url', value: string) => {
    const upd: UpdateMetadata = { [field]: value, expected_stamp: p.sidecar_stamp ?? null } as UpdateMetadata;
    update.mutate({ id: p.id, update: upd }, { onSuccess: () => { toast.success(t('creators.appliedOne', { value })); qc.invalidateQueries({ queryKey: ['creatorSuggestions'] }); }, onError: reportError });
  };
  const dismiss = (value: string) => getBackend().then((b) => b.dismissCreatorHint(p.id, value)).then(() => { qc.invalidateQueries({ queryKey: ['hints', p.id] }); qc.invalidateQueries({ queryKey: ['creatorSuggestions'] }); }).catch(reportError);
  return (
    <div className="mt-3 grid gap-1.5" data-testid="hint-chips">
      {rows.map(({ field, hint }) => (
        <div key={field} className="flex min-w-0 items-center gap-2 rounded-[10px] bg-accent/60 px-2.5 py-1.5 text-xs" data-testid={`hint-${field}`} title={t(`creators.source.${hint.source}` as const)}>
          <Lightbulb className="size-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate"><span className="text-muted-foreground">{t(`inspector.${field === 'source_url' ? 'source' : field}`)}: </span><b title={hint.value}>{hint.value}</b> <span className="text-muted-foreground">· {t(`creators.source.${hint.source}` as const)}</span></span>
          <Button size="icon-sm" variant="ghost" className="size-6" disabled={update.isPending} onClick={() => apply(field, hint.value)} title={t('creators.apply')} aria-label={t('creators.apply')} data-testid="hint-apply"><Check className="size-3.5" /></Button>
          {field === 'creator' && <Button size="icon-sm" variant="ghost" className="size-6 text-muted-foreground" onClick={() => void dismiss(hint.value)} title={t('creators.dismissHint')} aria-label={t('creators.dismiss')} data-testid="hint-dismiss"><X className="size-3.5" /></Button>}
        </div>
      ))}
    </div>
  );
}
