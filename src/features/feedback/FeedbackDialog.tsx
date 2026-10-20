import { Bug, ExternalLink, Lightbulb, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { getBackend } from '@/lib/backend';
import { getLastError } from '@/lib/diag';
import { reportError } from '@/lib/errors';
import { useAppInfo, useLibraryStats } from '@/lib/queries';
import { buildIssueUrl, environmentBlock, redactPaths, useFeedback, type FeedbackKind } from './feedback';

const LOG_LINES = 150;

/** "Send feedback": collects the report and opens the prefilled GitHub issue form (APP-12). */
export function FeedbackDialog() {
  const { t, i18n } = useTranslation();
  const { open, preset, close } = useFeedback();
  const info = useAppInfo();
  const stats = useLibraryStats();
  const [kind, setKind] = useState<FeedbackKind>('bug');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [withEnv, setWithEnv] = useState(true);
  const [withLog, setWithLog] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setKind(preset.kind ?? 'bug');
    setTitle(preset.title ?? '');
    setDetails(preset.details ?? '');
    setWithEnv(true);
    setWithLog((preset.kind ?? 'bug') === 'bug');
  }, [open, preset]);

  const environment = withEnv ? environmentBlock(info.data, { projects: stats.data?.projects, lastError: kind === 'bug' ? getLastError() : null, locale: i18n.language }) : '';
  const logWanted = kind === 'bug' && withLog;

  const submit = async () => {
    setBusy(true);
    try {
      const backend = await getBackend();
      let copied = false;
      if (logWanted) {
        const tail = redactPaths(await backend.logTail(LOG_LINES));
        if (tail) {
          try { await navigator.clipboard.writeText(tail); copied = true; } catch { /* clipboard blocked: the form still opens */ }
        }
      }
      await backend.openUrl(buildIssueUrl({ kind, title, details, environment, logHint: copied }));
      toast.success(copied ? t('feedback.openedWithLog') : t('feedback.opened'));
      close();
    } catch (e) {
      reportError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-[560px]" data-testid="feedback-dialog">
        <DialogHeader>
          <DialogTitle>{t('feedback.title')}</DialogTitle>
          <DialogDescription>{t('feedback.body')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <ToggleGroup type="single" value={kind} onValueChange={(v) => v && setKind(v as FeedbackKind)} className="justify-start" data-testid="feedback-kind">
            <ToggleGroupItem value="bug" aria-label={t('feedback.kinds.bug')}><Bug />{t('feedback.kinds.bug')}</ToggleGroupItem>
            <ToggleGroupItem value="idea" aria-label={t('feedback.kinds.idea')}><Lightbulb />{t('feedback.kinds.idea')}</ToggleGroupItem>
            <ToggleGroupItem value="other" aria-label={t('feedback.kinds.other')}><MessageSquare />{t('feedback.kinds.other')}</ToggleGroupItem>
          </ToggleGroup>
          <div className="grid gap-1.5">
            <Label htmlFor="fb-title">{t('feedback.summary')}</Label>
            <Input id="fb-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(`feedback.summaryHint.${kind}`)} maxLength={200} data-testid="feedback-title" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fb-details">{t('feedback.details')}</Label>
            <Textarea id="fb-details" value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t(`feedback.detailsHint.${kind}`)} rows={5} data-testid="feedback-details" />
          </div>
          <div className="grid gap-2 rounded-xl bg-secondary/60 p-3 text-[13px]">
            <label className="flex items-center justify-between gap-3"><span className="font-semibold">{t('feedback.includeEnv')}</span><Switch checked={withEnv} onCheckedChange={setWithEnv} data-testid="feedback-env" /></label>
            {withEnv && <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-background/70 p-2 font-mono text-[11px] text-muted-foreground" data-testid="feedback-env-preview">{environment}</pre>}
            {kind === 'bug' && (
              <label className="flex items-center justify-between gap-3"><span className="flex flex-col"><span className="font-semibold">{t('feedback.includeLog')}</span><span className="text-xs font-medium text-muted-foreground">{t('feedback.includeLogHint', { lines: LOG_LINES })}</span></span><Switch checked={withLog} onCheckedChange={setWithLog} data-testid="feedback-log" /></label>
            )}
          </div>
          <p className="text-xs font-medium text-muted-foreground">{t('feedback.publicNote')}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={close}>{t('common.cancel')}</Button>
          <Button onClick={() => void submit()} disabled={busy || (!title.trim() && !details.trim())} data-testid="feedback-submit"><ExternalLink />{t('feedback.submit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
