import type { FormEvent } from 'react';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, FolderSync, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/renderer/components/ui/badge';
import { Button } from '@/renderer/components/ui/button';
import { Input } from '@/renderer/components/ui/input';
import type { LibraryRoot } from '@/shared/api';

const queryKey = ['library-roots'] as const;

const formatLastSync = (value: string | null, fallback: string): string => {
  if (!value) {
    return fallback;
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const RootStatusBadge = ({ root }: { root: LibraryRoot }) => {
  const { t } = useTranslation();

  if (root.syncState === 'syncing') {
    return <Badge variant="secondary">{t('library.statusSyncing')}</Badge>;
  }

  if (root.syncState === 'error') {
    return <Badge variant="destructive">{t('library.statusError')}</Badge>;
  }

  return root.status === 'offline' ? (
    <Badge variant="destructive">{t('library.statusOffline')}</Badge>
  ) : (
    <Badge variant="outline">{t('library.statusOnline')}</Badge>
  );
};

export const LibraryPage = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const libraryRootsQuery = useQuery({
    queryKey,
    queryFn: () => window.appApi.listLibraryRoots(),
  });
  const [rootPath, setRootPath] = useState('');
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<'add' | 'rescan' | 'remove' | null>(null);

  const roots = libraryRootsQuery.data?.roots ?? [];
  const hasOfflineRoots = roots.some((root) => root.status === 'offline');

  const refreshSnapshot = (snapshot: Awaited<ReturnType<typeof window.appApi.listLibraryRoots>>) => {
    queryClient.setQueryData(queryKey, snapshot);
  };

  const handleAddRoot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPendingAction('add');
    setErrorKey(null);

    try {
      const snapshot = await window.appApi.addLibraryRoot(rootPath);
      refreshSnapshot(snapshot);
      setRootPath('');
    } catch {
      setErrorKey('library.invalidRoot');
    } finally {
      setPendingAction(null);
    }
  };

  const handleRescan = async (rootId: number) => {
    setPendingAction('rescan');

    try {
      const snapshot = await window.appApi.rescanLibraryRoot(rootId);
      refreshSnapshot(snapshot);
    } finally {
      setPendingAction(null);
    }
  };

  const handleRemove = async (rootId: number) => {
    setPendingAction('remove');

    try {
      const snapshot = await window.appApi.removeLibraryRoot(rootId);
      refreshSnapshot(snapshot);
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto" data-testid="library-page">
      <section className="flex flex-col gap-3 rounded-[28px] border border-border/80 bg-background/70 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          {t('library.kicker')}
        </p>
        <h2 className="text-3xl font-semibold tracking-tight">{t('library.title')}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t('library.summary')}</p>
        <form className="mt-2 flex flex-col gap-3 md:flex-row" data-testid="library-root-form" onSubmit={handleAddRoot}>
          <label className="sr-only" htmlFor="library-root-path">
            {t('library.inputLabel')}
          </label>
          <Input
            id="library-root-path"
            data-testid="library-root-input"
            value={rootPath}
            onChange={(event) => setRootPath(event.target.value)}
            placeholder={t('library.inputPlaceholder')}
          />
          <Button data-testid="add-library-root" disabled={pendingAction === 'add'} type="submit">
            {pendingAction === 'add' ? t('library.addRootBusy') : t('library.addRoot')}
          </Button>
        </form>
        {errorKey ? (
          <div
            className="flex items-start gap-3 rounded-2xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-foreground"
            data-testid="library-form-error"
          >
            <AlertTriangle className="mt-0.5 text-destructive" />
            <span>{t(errorKey)}</span>
          </div>
        ) : null}
        {hasOfflineRoots ? (
          <div className="rounded-2xl border border-border/80 bg-secondary/60 px-4 py-3 text-sm text-secondary-foreground">
            {t('library.offlineHint')}
          </div>
        ) : null}
      </section>

      {roots.length === 0 ? (
        <section className="rounded-[28px] border border-dashed border-border/80 bg-background/70 p-8 text-center shadow-sm">
          <h3 className="text-xl font-semibold tracking-tight">{t('library.emptyTitle')}</h3>
          <p className="mx-auto mt-3 max-w-2xl text-sm text-muted-foreground">
            {t('library.emptyCopy')}
          </p>
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {roots.map((root) => (
            <article
              key={root.id}
              data-testid={`library-root-card-${root.id}`}
              className="rounded-[28px] border border-border/80 bg-background/80 p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="text-xl font-semibold tracking-tight">{root.name}</h3>
                    <div data-testid={`library-root-status-${root.id}`}>
                      <RootStatusBadge root={root} />
                    </div>
                  </div>
                  <p className="mt-2 break-all text-sm text-muted-foreground">{root.path}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid={`rescan-library-root-${root.id}`}
                    disabled={pendingAction === 'rescan'}
                    onClick={() => void handleRescan(root.id)}
                  >
                    <FolderSync data-icon="inline-start" />
                    {t('library.rescan')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-testid={`remove-library-root-${root.id}`}
                    disabled={pendingAction === 'remove'}
                    onClick={() => void handleRemove(root.id)}
                  >
                    <Trash2 data-icon="inline-start" />
                    {t('library.remove')}
                  </Button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 rounded-3xl bg-secondary/45 p-4 sm:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {t('library.itemCount', { count: root.itemCount })}
                  </p>
                  <p className="mt-2 text-2xl font-semibold tracking-tight">
                    {root.itemCount}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    {t('library.lastSyncPrefix')}
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {formatLastSync(root.lastSyncAt, t('library.lastSyncNever'))}
                  </p>
                </div>
              </div>

              <div className="mt-5">
                <p className="text-sm font-semibold text-foreground">{t('library.sampleFiles')}</p>
                <ul className="mt-3 flex list-none flex-col gap-2 p-0">
                  {root.sampleItems.map((item) => (
                    <li
                      key={item.id}
                      className="rounded-2xl border border-border/70 bg-background/75 px-4 py-3 text-sm text-muted-foreground"
                    >
                      {item.relativePath}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
};