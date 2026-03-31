import type { CSSProperties } from 'react';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, LayoutDashboard, Layers3, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HashRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { WindowControls } from '@/renderer/components/window-controls';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { DashboardPage } from '@/renderer/routes/dashboard-page';
import { LibraryPage } from '@/renderer/routes/library-page';
import { SettingsPage } from '@/renderer/routes/settings-page';
import { cn } from '@/renderer/lib/cn';

const queryKeys = {
  bootstrap: ['bootstrap'],
  libraryRoots: ['library-roots'],
} as const;

const navigationItems = [
  {
    to: '/',
    labelKey: 'nav.dashboard',
    icon: LayoutDashboard,
    testId: 'nav-dashboard',
  },
  {
    to: '/library',
    labelKey: 'nav.library',
    icon: HardDrive,
    testId: 'nav-library',
  },
  {
    to: '/settings',
    labelKey: 'nav.settings',
    icon: Settings,
    testId: 'nav-settings',
  },
] as const;

const AppFrame = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const bootstrapQuery = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => window.appApi.getBootstrap(),
  });
  const libraryRootsQuery = useQuery({
    queryKey: queryKeys.libraryRoots,
    queryFn: () => window.appApi.listLibraryRoots(),
  });

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  useEffect(() => {
    return window.appApi.onLibraryRootsChanged((snapshot) => {
      queryClient.setQueryData(queryKeys.libraryRoots, snapshot);
    });
  }, [queryClient]);

  const rootCount = libraryRootsQuery.data?.roots.length ?? 0;
  const offlineCount =
    libraryRootsQuery.data?.roots.filter((root) => root.status === 'offline').length ??
    0;

  return (
    <div className="app-shell mesh-grid">
      <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-r from-primary/20 via-transparent to-accent/25 blur-3xl" />
      <div className="relative flex min-h-screen flex-col px-4 pb-4 pt-3 sm:px-6 lg:px-8">
        <header
          className="surface-panel mb-4 flex items-center justify-between gap-4 px-4 py-3"
          style={{ WebkitAppRegion: 'drag' } as CSSProperties}
        >
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-inner">
              <Layers3 />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <h1 className="truncate text-lg font-semibold tracking-tight">
                  {t('app.title')}
                </h1>
                {bootstrapQuery.data?.isTestMode ? (
                  <Badge variant="secondary" data-testid="test-mode-badge">
                    {t('app.testMode')}
                  </Badge>
                ) : null}
              </div>
              <p className="truncate text-sm text-muted-foreground">
                {t('app.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" data-testid="shell-root-count">
              {t('app.rootCount', { count: rootCount })}
            </Badge>
            {offlineCount > 0 ? (
              <Badge variant="destructive" data-testid="shell-offline-count">
                {t('app.offlineCount', { count: offlineCount })}
              </Badge>
            ) : null}
            <WindowControls />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="surface-panel flex flex-col gap-3 p-3">
            {navigationItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  data-testid={item.testId}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                    )
                  }
                >
                  <Icon />
                  <span>{t(item.labelKey)}</span>
                </NavLink>
              );
            })}

            <div className="mt-auto rounded-3xl border border-dashed border-border/80 bg-background/70 p-4 text-sm text-muted-foreground">
              <p className="text-balance font-medium text-foreground">
                {t('app.agentHarnessTitle')}
              </p>
              <p className="mt-2 text-balance">{t('app.agentHarnessCopy')}</p>
              <Button asChild className="mt-4 w-full" variant="secondary">
                <NavLink to="/library">{t('app.reviewRoots')}</NavLink>
              </Button>
            </div>
          </aside>

          <main className="surface-panel min-h-0 overflow-hidden p-4 sm:p-6">
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  );
};

export const App = () => {
  return (
    <HashRouter>
      <AppFrame />
    </HashRouter>
  );
};