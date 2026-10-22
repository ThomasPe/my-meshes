import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { TopBar } from '@/components/app-shell/TopBar';
import { StatusBar } from '@/components/app-shell/StatusBar';
import { Toaster } from '@/components/ui/sonner';
import { FeedbackDialog } from '@/features/feedback/FeedbackDialog';
import { DropOverlay, ImportDialog } from '@/features/import/ImportDialog';
import { wireImportEvents } from '@/features/import/useImport';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LibraryPage, loadPanels, savePanels, separatorClass } from '@/features/library/LibraryPage';
import { Sidebar } from '@/features/library/Sidebar';
import { useLibraryActions } from '@/features/library/useLibraryActions';
import { ProjectPage } from '@/features/project/ProjectPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { WelcomePage } from '@/features/welcome/WelcomePage';
import { queryClient, useAppInfo, useBackendEvents, useRoots } from '@/lib/queries';
import { useOsNotifications } from '@/features/settings/useOsNotifications';
import { useStartupUpdateCheck } from '@/features/settings/useStartupUpdateCheck';
import { isTauri } from '@/lib/backend';
import { installErrorReporting } from '@/lib/diag';
import { installNativeShellGuards } from '@/lib/native-shell';
import { navigate, useRoute } from '@/lib/router';

export type ScanState = Record<string, number>; // rootId -> projects found so far
const SHELL_LAYOUT_KEY = 'mm.shell.panels';

function Shell() {
  const route = useRoute();
  const roots = useRoots();
  const [scanning, setScanning] = useState<ScanState>({});
  const onScan = useCallback((rootId: string, found: number) => setScanning((s) => ({ ...s, [rootId]: found })), []);
  useBackendEvents(onScan);
  useEffect(() => { wireImportEvents(); }, []);
  const info = useAppInfo();
  useStartupUpdateCheck(info.data);
  useOsNotifications();
  useEffect(() => installErrorReporting(), []);
  useEffect(() => {
    if (!isTauri || import.meta.env.DEV || info.data?.testMode) return;
    return installNativeShellGuards({ allowDevtools: info.data?.channel === 'dev' });
  }, [info.data?.testMode, info.data?.channel]);
  const scanEnd = useCallback((rootId: string) => setScanning((s) => { const n = { ...s }; delete n[rootId]; return n; }), []);
  const { scan } = useLibraryActions(scanEnd);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const panels = useMemo(() => loadPanels<{ sidebar: number }>(SHELL_LAYOUT_KEY), []);

  // First run: no roots -> welcome. Keep explicit navigation otherwise.
  useEffect(() => {
    if (roots.data && roots.data.length === 0 && route.page === 'library') navigate({ page: 'welcome' });
  }, [roots.data, route.page]);

  const page =
    route.page === 'welcome' ? <WelcomePage onScanEnd={scanEnd} /> :
    route.page === 'project' ? <ProjectPage id={route.id} /> :
    route.page === 'settings' ? <SettingsPage scanning={scanning} onScanEnd={scanEnd} /> :
    <LibraryPage scanning={scanning} onScanEnd={scanEnd} />;
  // The navigation sidebar belongs to the shell (NAV-1): it stays put while a project is open,
  // so the tree, collections and tags keep showing where you are. Welcome and Settings are
  // full-width screens without it.
  const withSidebar = route.page === 'library' || route.page === 'project';

  return (
    <div className="grid h-full grid-rows-[56px_minmax(0,1fr)_30px]" data-testid="app">
      <TopBar route={route} />
      <div className="min-h-0 min-w-0">
        {withSidebar ? (
          <Group orientation="horizontal" className="h-full" elementRef={groupRef} onLayoutChanged={(l) => savePanels(SHELL_LAYOUT_KEY, ['sidebar'], l, groupRef.current?.clientWidth ?? 0)} data-testid="shell-panels">
            <Panel id="sidebar" defaultSize={panels.sidebar ?? 250} minSize={200} maxSize={480} className="min-w-0" data-testid="panel-sidebar"><Sidebar onRescan={(id) => void scan(id)} /></Panel>
            <Separator className={separatorClass} aria-label="resize sidebar" data-testid="resize-sidebar" />
            <Panel id="content" minSize={640} className="min-w-0">{page}</Panel>
          </Group>
        ) : page}
      </div>
      <StatusBar scanning={scanning} />
      <ImportDialog />
      <DropOverlay />
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Shell />
        <FeedbackDialog />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
