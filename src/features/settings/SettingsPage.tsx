import { Bell, Bug, Download, FolderOpen, HardDrive, Images, KeyRound, Loader2, Monitor, Moon, Plus, RefreshCw, Sparkles, Sun, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ScanState } from '@/App';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { openFeedback } from '@/features/feedback/feedback';
import { useLibraryActions } from '@/features/library/useLibraryActions';
import { LANGUAGES, setLanguage, type Language } from '@/i18n';
import { getBackend } from '@/lib/backend';
import { reportError } from '@/lib/errors';
import { formatDate, formatDuration } from '@/lib/format';
import { invalidateLibrary, keys, useAiSettings, useAppInfo, useContainerDirs, useIgnorePatterns, useRoots, useSetAiKey, useSetAiSettings, useSetThumbLocation, useThumbLocation, useThumbStats } from '@/lib/queries';
import { kickThumbQueue, useThumbs } from '@/lib/thumbs/queue';
import { dropThumbnailCache } from '@/lib/thumbs/useThumbnail';
import { applyTheme, loadNotifications, loadTheme, saveNotifications, type Theme } from '@/lib/store';
import { isAppError, type AiTestReport, type LibraryRoot, type SyncMode, type ThumbLocation, type UpdateInfo } from '@/lib/types';
import { useQueryClient } from '@tanstack/react-query';

export function SettingsPage({ scanning, onScanEnd }: { scanning: ScanState; onScanEnd: (rootId: string) => void }) {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const roots = useRoots();
  const info = useAppInfo();
  const ignore = useIgnorePatterns();
  const containers = useContainerDirs();
  const thumbStats = useThumbStats();
  const thumbs = useThumbs();
  const thumbLocation = useThumbLocation();
  const setThumbLocation = useSetThumbLocation();
  const [notify, setNotify] = useState(loadNotifications());
  const { scan, addRootViaPicker, removeRoot } = useLibraryActions(onScanEnd);
  const [removing, setRemoving] = useState<LibraryRoot | null>(null);
  const [theme, setTheme] = useState<Theme>(loadTheme());
  const [pattern, setPattern] = useState('');
  const [container, setContainer] = useState('');
  const [update, setUpdate] = useState<{ state: 'idle' | 'checking' | 'result' | 'installing'; info?: UpdateInfo; error?: string }>({ state: 'idle' });
  const checkUpdate = async () => {
    setUpdate({ state: 'checking' });
    try { const b = await getBackend(); setUpdate({ state: 'result', info: await b.checkUpdate() }); } catch (e) { setUpdate({ state: 'result', error: e instanceof Error ? e.message : (e as { message?: string }).message ?? String(e) }); }
  };
  const installUpdate = async () => {
    setUpdate((u) => ({ ...u, state: 'installing' }));
    try { const b = await getBackend(); await b.installUpdate(); } catch (e) { reportError(e); setUpdate({ state: 'idle' }); }
  };

  const setMode = async (root: LibraryRoot, mode: SyncMode, pollIntervalSecs?: number) => {
    try { const b = await getBackend(); await b.setRootMode(root.id, mode, pollIntervalSecs); await qc.invalidateQueries({ queryKey: keys.roots }); } catch (e) { reportError(e); }
  };
  const saveContainers = async (next: string[]) => {
    try { const b = await getBackend(); await b.setContainerDirs(next); await qc.invalidateQueries({ queryKey: keys.containers }); toast.success(t('settings.containerSaved')); } catch (e) { reportError(e); }
  };
  const clearThumbs = async () => {
    try { const b = await getBackend(); await b.clearThumbnails(); dropThumbnailCache(); invalidateLibrary(qc); toast(t('settings.thumbsCleared')); void kickThumbQueue(); } catch (e) { reportError(e); }
  };
  const savePatterns = async (next: string[]) => {
    try { const b = await getBackend(); await b.setIgnorePatterns(next); await qc.invalidateQueries({ queryKey: keys.ignore }); toast.success(t('settings.patternSaved')); } catch (e) { reportError(e); }
  };

  return (
    <div className="h-full overflow-auto" data-testid="settings">
      <div className="mx-auto grid max-w-[920px] gap-5 px-6 pb-10 pt-5">
        <h1 className="text-2xl font-extrabold tracking-tight">{t('settings.title')}</h1>

        <Card title={t('settings.roots')} hint={t('settings.rootsHint')} action={<Button size="sm" onClick={() => void addRootViaPicker()} data-testid="add-root"><Plus />{t('settings.addFolder')}</Button>}>
          {(roots.data ?? []).map((r) => (
            <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_minmax(190px,max-content)_auto_auto] items-center gap-3.5 border-b border-border py-3.5 last:border-0" data-testid="root-row">
              <div className="flex min-w-0 items-center gap-2.5"><FolderOpen className="size-4 shrink-0 text-muted-foreground" /><div className="min-w-0"><div className="truncate font-extrabold" title={r.path}>{r.path}</div><div className="text-xs font-semibold text-muted-foreground">{r.last_scan_at ? t('settings.lastScan', { when: formatDate(r.last_scan_at, i18n.language) }) : t('settings.neverScanned')}</div>
                {r.last_scan && <div className="text-xs text-muted-foreground tabular" data-testid="root-scan-summary">{t('settings.scanSummary', { projects: r.last_scan.projects, files: r.last_scan.files, time: formatDuration(r.last_scan.millis), trigger: t(`settings.trigger.${r.last_scan.trigger}`, { defaultValue: r.last_scan.trigger }) })}{r.last_scan.warning_count > 0 && <details className="inline"><summary className="ml-2 inline cursor-pointer text-warning">{t('settings.scanWarnings', { count: r.last_scan.warning_count })}</summary><ul className="mt-1 list-disc pl-4 text-warning">{r.last_scan.warnings.map((w) => <li key={w} className="break-all">{w}</li>)}</ul></details>}</div>}
                {r.last_error && <div className="text-xs font-semibold text-warning" data-testid="root-error">{t('settings.lastError')}: {r.last_error}</div>}</div></div>
              <div className="grid gap-1">
                <Select value={r.mode} onValueChange={(v) => void setMode(r, v as SyncMode)}>
                  <SelectTrigger size="sm" className="w-full shadow-none" data-testid="root-mode"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="watch">{t('settings.mode.watch')}</SelectItem><SelectItem value="poll">{t('settings.mode.poll')}</SelectItem><SelectItem value="manual">{t('settings.mode.manual')}</SelectItem></SelectContent>
                </Select>
                {r.mode === 'poll' && (
                  <Select value={String(nearestInterval(r.poll_interval_secs))} onValueChange={(v) => void setMode(r, 'poll', Number(v))}>
                    <SelectTrigger size="sm" className="w-full shadow-none" data-testid="poll-interval"><span className="text-muted-foreground">{t('settings.every')}</span><SelectValue /></SelectTrigger>
                    <SelectContent>{INTERVALS.map((m) => <SelectItem key={m} value={String(m * 60)}>{t('settings.minutes', { count: m })}</SelectItem>)}</SelectContent>
                  </Select>
                )}
              </div>
              <Badge variant={r.status === 'offline' ? 'warning' : r.status === 'online' ? 'success' : 'outline'}>{t(`settings.status.${r.status}`)}</Badge>
              <div className="flex gap-1">
                <Button size="icon-sm" variant="ghost" title={t('settings.rescan')} disabled={r.id in scanning} onClick={() => void scan(r.id)} data-testid="rescan-root"><RefreshCw className={r.id in scanning ? 'animate-spin' : ''} /></Button>
                <Button size="icon-sm" variant="ghost" title={t('settings.remove')} onClick={() => setRemoving(r)} data-testid="remove-root"><Trash2 /></Button>
              </div>
            </div>
          ))}
          {roots.data?.length === 0 && <p className="py-3 text-sm text-muted-foreground">{t('status.noRoots')}</p>}
        </Card>

        <Card title={t('settings.ignore')} hint={t('settings.ignoreHint')}>
          <div className="flex flex-wrap items-center gap-1.5">
            {(ignore.data ?? []).map((p) => <span key={p} className="inline-flex items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1 py-0.5 font-mono text-xs font-semibold">{p}<button type="button" aria-label={`remove ${p}`} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive" onClick={() => void savePatterns((ignore.data ?? []).filter((x) => x !== p))}><X className="size-3" /></button></span>)}
            <Input value={pattern} placeholder={t('settings.addPattern')} className="h-7 w-44 rounded-full font-mono text-xs" onChange={(e) => setPattern(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && pattern.trim()) { void savePatterns([...(ignore.data ?? []), pattern.trim()]); setPattern(''); } }} />
          </div>
        </Card>

        <Card title={t('settings.containers')} hint={t('settings.containersHint')}>
          <div className="flex flex-wrap items-center gap-1.5" data-testid="container-dirs">
            {(containers.data ?? []).map((n) => <span key={n} className="inline-flex items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1 py-0.5 font-mono text-xs font-semibold">{n}<button type="button" aria-label={`remove ${n}`} className="rounded-full p-0.5 text-muted-foreground hover:text-destructive" onClick={() => void saveContainers((containers.data ?? []).filter((x) => x !== n))}><X className="size-3" /></button></span>)}
            <Input value={container} placeholder={t('settings.addContainer')} className="h-7 w-44 rounded-full font-mono text-xs" onChange={(e) => setContainer(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && container.trim()) { void saveContainers([...(containers.data ?? []), container.trim()]); setContainer(''); } }} />
          </div>
        </Card>

        <Card title={t('settings.previews')} hint={t('settings.previewsHint')} action={<Button size="sm" variant="outline" onClick={() => void clearThumbs()} data-testid="clear-thumbs"><Images />{t('settings.clearThumbs')}</Button>}>
          <div className="text-[13px] font-semibold text-secondary-foreground" data-testid="thumb-summary">
            {t('settings.thumbSummary', { done: thumbStats.data?.done ?? 0, pending: thumbStats.data?.pending ?? 0, failed: thumbStats.data?.failed ?? 0 })}
            {thumbs.unavailable && <span className="ml-2 text-warning" title={thumbs.unavailable}>{t('status.thumbsUnavailable')}</span>}
          </div>
          <Row label={t('settings.thumbLocation')}>
            <div className="grid justify-items-end gap-1">
              <ToggleGroup type="single" value={thumbLocation.data ?? 'app_data'} onValueChange={(v) => { if (v) setThumbLocation.mutate(v as ThumbLocation, { onSuccess: () => toast.success(t('settings.thumbLocationSaved')), onError: reportError }); }} data-testid="thumb-location">
                <ToggleGroupItem value="app_data" data-testid="thumb-location-app"><HardDrive />{t('settings.thumbLocationApp')}</ToggleGroupItem>
                <ToggleGroupItem value="project" data-testid="thumb-location-project"><FolderOpen />{t('settings.thumbLocationProject')}</ToggleGroupItem>
              </ToggleGroup>
              <span className="max-w-[46ch] text-right text-xs text-muted-foreground">{thumbLocation.data === 'project' ? t('settings.thumbLocationHintProject') : t('settings.thumbLocationHintApp')}</span>
            </div>
          </Row>
        </Card>

        <Card title={t('settings.notifications')} hint={t('settings.notificationsHint')}>
          <Row label={t('settings.notificationsToggle')}>
            <label className="flex items-center gap-2 text-sm text-muted-foreground"><Bell className="size-4" /><Switch checked={notify} onCheckedChange={(v) => { setNotify(v); saveNotifications(v); }} data-testid="notifications-toggle" aria-label={t('settings.notificationsToggle')} /></label>
          </Row>
        </Card>

        <AiCard />

        <Card title={t('settings.appearance')}>
          <Row label={t('settings.theme')}>
            <ToggleGroup type="single" value={theme} onValueChange={(v) => { if (v) { applyTheme(v as Theme); setTheme(v as Theme); } }}>
              <ToggleGroupItem value="light"><Sun />{t('settings.themes.light')}</ToggleGroupItem>
              <ToggleGroupItem value="dark"><Moon />{t('settings.themes.dark')}</ToggleGroupItem>
              <ToggleGroupItem value="system"><Monitor />{t('settings.themes.system')}</ToggleGroupItem>
            </ToggleGroup>
          </Row>
          <Row label={t('settings.language')}>
            <Select value={i18n.language.slice(0, 2)} onValueChange={(v) => setLanguage(v as Language)}>
              <SelectTrigger size="sm" className="shadow-none" data-testid="language"><SelectValue /></SelectTrigger>
              <SelectContent>{LANGUAGES.map((l) => <SelectItem key={l} value={l}>{l === 'de' ? 'Deutsch' : 'English'}</SelectItem>)}</SelectContent>
            </Select>
          </Row>
        </Card>

        <Card title={t('settings.updates')} hint={info.data?.store ? t('settings.updatesStore') : info.data?.updater ? (info.data.channel === 'dev' ? t('settings.updatesDevChannel') : t('settings.updatesPrivate')) : t('settings.updatesDev')} action={info.data?.updater ? <Button size="sm" variant="outline" disabled={update.state === 'checking' || update.state === 'installing'} onClick={() => void checkUpdate()} data-testid="check-update"><Download />{t('settings.checkUpdate')}</Button> : undefined}>
          <div className="text-[13px] font-semibold text-secondary-foreground" data-testid="update-status">
            {update.state === 'checking' && t('settings.updateChecking')}
            {update.state === 'result' && update.error && <span className="text-warning">{t('settings.updateError', { message: update.error })}</span>}
            {update.state === 'result' && update.info && !update.info.available && t('settings.updateNone')}
            {(update.state === 'result' || update.state === 'installing') && update.info?.available && (
              <span className="flex flex-wrap items-center gap-2">{t('settings.updateAvailable', { version: update.info.version })}<Button size="sm" disabled={update.state === 'installing'} onClick={() => void installUpdate()} data-testid="install-update">{update.state === 'installing' ? t('settings.updateInstalling') : t('settings.installUpdate')}</Button></span>
            )}
            {update.state === 'idle' && (info.data?.updater ? t('settings.updateIdle') : info.data?.store ? t('settings.updatesStore') : t('settings.updatesDev'))}
          </div>
        </Card>

        <Card title={t('settings.feedback')} hint={t('settings.feedbackHint')} action={<Button size="sm" variant="outline" onClick={() => openFeedback()} data-testid="send-feedback"><Bug />{t('settings.sendFeedback')}</Button>}>
          <div className="text-[13px] font-semibold text-secondary-foreground"><a className="underline-offset-2 hover:underline" href="https://github.com/ThomasPe/my-meshes/issues" target="_blank" rel="noreferrer">github.com/ThomasPe/my-meshes/issues</a></div>
        </Card>

        <Card title={t('settings.about')}>
          <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-muted-foreground">{t('settings.version')}</dt><dd className="font-semibold">{info.data?.version} {info.data?.testMode && <Badge variant="warning">{t('settings.testMode')}</Badge>} {info.data?.e2eBuild && <Badge variant="outline">e2e</Badge>} {info.data?.store && <Badge variant="accent">Store</Badge>} {info.data?.channel && <Badge variant="outline" data-testid="channel-badge">{t('settings.channel', { channel: info.data.channel })}</Badge>}</dd>
            <dt className="text-muted-foreground">{t('settings.dataDir')}</dt><dd className="break-all font-mono text-xs" data-testid="data-dir">{info.data?.dataDir}</dd>
            <dt className="text-muted-foreground">{t('settings.webview')}</dt><dd className="font-semibold">{info.data?.webview} · {info.data?.os} {info.data?.arch}</dd>
          </dl>
        </Card>
      </div>

      <Dialog open={!!removing} onOpenChange={(o) => !o && setRemoving(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('settings.removeTitle', { path: removing?.path })}</DialogTitle><DialogDescription>{t('settings.removeBody')}</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setRemoving(null)}>{t('common.cancel')}</Button><Button variant="destructive" data-testid="confirm-remove" onClick={() => { if (removing) void removeRoot(removing.id); setRemoving(null); }}>{t('settings.remove')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * AI assistance (ADR-0003, Epic 9): endpoint and model go to settings.json, the key to the OS
 * credential store, and the card says in plain words what a suggestion sends.
 */
function AiCard() {
  const { t } = useTranslation();
  const ai = useAiSettings();
  const setSettings = useSetAiSettings();
  const setKey = useSetAiKey();
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [key, setKeyInput] = useState('');
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'failed'; report?: AiTestReport; error?: string }>({ state: 'idle' });
  const curBase = baseUrl ?? ai.data?.base_url ?? '';
  const curModel = model ?? ai.data?.model ?? '';
  const dirty = !!ai.data && (curBase !== (ai.data.base_url ?? '') || curModel !== ai.data.model);
  const save = () => setSettings.mutate({ provider: 'anthropic', base_url: curBase.trim() || null, model: curModel }, {
    onSuccess: () => { setBaseUrl(null); setModel(null); toast.success(t('settings.aiSaved')); },
    onError: reportError,
  });
  const saveKey = () => setKey.mutate(key, { onSuccess: () => { setKeyInput(''); setTest({ state: 'idle' }); toast.success(t('settings.aiKeySaved')); }, onError: reportError });
  const removeKey = () => setKey.mutate(null, { onSuccess: () => { setTest({ state: 'idle' }); toast(t('settings.aiKeyRemoved')); }, onError: reportError });
  const runTest = async () => {
    setTest({ state: 'testing' });
    try { const b = await getBackend(); setTest({ state: 'ok', report: await b.testAi() }); } catch (e) { setTest({ state: 'failed', error: isAppError(e) ? t(`errors.${e.code}`, { defaultValue: e.message, message: e.message }) : String(e) }); }
  };
  return (
    <Card title={t('settings.ai')} hint={t('settings.aiHint')} action={<Button size="sm" variant="outline" disabled={!ai.data?.hasKey || test.state === 'testing'} onClick={() => void runTest()} data-testid="ai-test"><Sparkles />{test.state === 'testing' ? t('settings.aiTesting') : t('settings.aiTest')}</Button>}>
      <Row label={t('settings.aiProvider')}><span className="text-sm font-semibold text-secondary-foreground">{t('settings.aiProviderAnthropic')}</span></Row>
      <Row label={t('settings.aiBaseUrl')}>
        <div className="grid w-full max-w-md justify-items-end gap-1">
          <Input value={curBase} placeholder="https://api.anthropic.com" className="h-8 w-full font-mono text-xs" onChange={(e) => setBaseUrl(e.target.value)} data-testid="ai-base-url" />
          <span className="text-right text-xs text-muted-foreground">{t('settings.aiBaseUrlHint')}</span>
        </div>
      </Row>
      <Row label={t('settings.aiModel')}>
        <div className="flex w-full max-w-md items-center gap-2">
          <Input value={curModel} className="h-8 font-mono text-xs" onChange={(e) => setModel(e.target.value)} data-testid="ai-model" />
          <Button size="sm" disabled={!dirty || setSettings.isPending} onClick={save} data-testid="ai-save">{t('settings.aiSave')}</Button>
        </div>
      </Row>
      <Row label={t('settings.aiKey')}>
        <div className="grid w-full max-w-md justify-items-end gap-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold" data-testid="ai-key-status" data-state={ai.data?.hasKey ? 'stored' : 'missing'}><KeyRound className={ai.data?.hasKey ? 'size-3.5 text-success' : 'size-3.5 text-muted-foreground'} />{ai.data?.hasKey ? t('settings.aiKeyStored') : t('settings.aiKeyMissing')}</div>
          <form className="flex w-full items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (key.trim()) saveKey(); }}>
            <Input type="password" autoComplete="off" value={key} placeholder={t('settings.aiKeyPlaceholder')} className="h-8 font-mono text-xs" onChange={(e) => setKeyInput(e.target.value)} data-testid="ai-key" />
            <Button type="submit" size="sm" disabled={!key.trim() || setKey.isPending} data-testid="ai-key-save">{t('settings.aiKeySave')}</Button>
            {ai.data?.hasKey && <Button type="button" size="sm" variant="ghost" disabled={setKey.isPending} onClick={removeKey} data-testid="ai-key-remove">{t('settings.aiKeyRemove')}</Button>}
          </form>
        </div>
      </Row>
      <div className="py-3 text-[13px] font-semibold text-secondary-foreground" data-testid="ai-test-status" data-state={test.state} aria-live="polite">
        {test.state === 'testing' && <span className="inline-flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" />{t('settings.aiTesting')}</span>}
        {test.state === 'ok' && <span className="text-success">{t('settings.aiTestOk', { model: test.report?.model })}</span>}
        {test.state === 'failed' && <span className="text-warning">{t('settings.aiTestFailed', { message: test.error })}</span>}
      </div>
      <p className="rounded-[10px] bg-accent p-3 text-xs font-semibold text-accent-foreground" data-testid="ai-sent">{t('settings.aiSent')}</p>
    </Card>
  );
}

const INTERVALS = [1, 5, 15, 30, 60, 180];
function nearestInterval(secs: number): number {
  const m = secs / 60;
  return (INTERVALS.find((x) => x >= m) ?? INTERVALS[INTERVALS.length - 1]!) * 60;
}

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl bg-card p-5 shadow-card">
      <div className="mb-2 flex flex-wrap items-center gap-x-2.5 gap-y-1"><h2 className="shrink-0 whitespace-nowrap text-base font-extrabold tracking-tight">{title}</h2>{hint && <span className="min-w-0 flex-1 basis-60 text-xs font-semibold text-muted-foreground">{hint}</span>}{action && <span className="ml-auto shrink-0">{action}</span>}</div>
      {children}
    </section>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border py-3 last:border-0"><b className="shrink-0 text-sm">{label}</b>{children}</div>;
}
