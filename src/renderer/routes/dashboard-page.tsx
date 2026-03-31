import { useQuery } from '@tanstack/react-query';
import { Database, FolderSearch, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { Button } from '@/renderer/components/ui/button';

const queryKeys = {
  bootstrap: ['bootstrap'],
  libraryRoots: ['library-roots'],
} as const;

export const DashboardPage = () => {
  const { t } = useTranslation();
  const bootstrapQuery = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => window.appApi.getBootstrap(),
  });
  const libraryRootsQuery = useQuery({
    queryKey: queryKeys.libraryRoots,
    queryFn: () => window.appApi.listLibraryRoots(),
  });

  const roots = libraryRootsQuery.data?.roots ?? [];
  const onlineRoots = roots.filter((root) => root.status === 'online').length;
  const offlineRoots = roots.filter((root) => root.status === 'offline').length;

  const cards = [
    {
      key: 'roots',
      icon: FolderSearch,
      label: t('dashboard.libraryRoots'),
      value: roots.length,
      testId: 'metric-roots',
    },
    {
      key: 'online',
      icon: ShieldCheck,
      label: t('dashboard.onlineRoots'),
      value: onlineRoots,
      testId: 'metric-online-roots',
    },
    {
      key: 'offline',
      icon: Database,
      label: t('dashboard.offlineRoots'),
      value: offlineRoots,
      testId: 'metric-offline-roots',
    },
  ];

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto" data-testid="dashboard-page">
      <section className="rounded-[32px] bg-gradient-to-br from-primary/90 via-primary to-accent p-6 text-primary-foreground shadow-[0_28px_60px_-30px_rgba(8,47,73,0.7)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary-foreground/75">
          {t('dashboard.kicker')}
        </p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('dashboard.title')}
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-primary-foreground/85 sm:text-base">
          {t('dashboard.summary')}
        </p>
        <Button asChild className="mt-6" variant="secondary">
          <NavLink to="/library">{t('dashboard.openLibrary')}</NavLink>
        </Button>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <article
              key={card.key}
              data-testid={card.testId}
              className="rounded-[28px] border border-border/80 bg-background/80 p-5 shadow-sm"
            >
              <div className="flex items-center gap-3 text-muted-foreground">
                <Icon />
                <span className="text-sm font-medium">{card.label}</span>
              </div>
              <div className="mt-4 text-3xl font-semibold tracking-tight">
                {card.value}
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.4fr_minmax(0,1fr)]">
        <article className="rounded-[28px] border border-border/80 bg-background/80 p-5 shadow-sm">
          <p className="text-sm font-semibold text-foreground">
            {t('dashboard.bootstrap')}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('dashboard.bootstrapReady')}
          </p>
          <div className="mt-4 rounded-2xl bg-secondary/60 p-4 text-sm text-secondary-foreground">
            <div data-testid="bootstrap-database-ready">
              {t('dashboard.databaseReady')}:{' '}
              {bootstrapQuery.data?.database.isReady
                ? t('common.ready')
                : t('common.notReady')}
            </div>
            <div className="mt-2 break-all" data-testid="bootstrap-database-path">
              {t('dashboard.databasePath')}: {bootstrapQuery.data?.database.path}
            </div>
          </div>
        </article>

        <article className="rounded-[28px] border border-border/80 bg-background/80 p-5 shadow-sm">
          <p className="text-sm font-semibold text-foreground">
            {t('dashboard.routerDemo')}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('dashboard.routerDemoCopy')}
          </p>
          <p className="mt-4 text-sm font-medium text-foreground" data-testid="runtime-mode-copy">
            {bootstrapQuery.data?.isTestMode
              ? t('dashboard.testModeEnabled')
              : t('dashboard.testModeDisabled')}
          </p>
        </article>
      </section>
    </div>
  );
};