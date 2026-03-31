import { useQuery } from '@tanstack/react-query';
import { FlaskConical, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export const SettingsPage = () => {
  const { t } = useTranslation();
  const bootstrapQuery = useQuery({
    queryKey: ['bootstrap'],
    queryFn: () => window.appApi.getBootstrap(),
  });

  return (
    <div className="flex h-full flex-col gap-6 overflow-auto" data-testid="settings-page">
      <section className="rounded-[28px] border border-border/80 bg-background/70 p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          {t('settings.kicker')}
        </p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight">{t('settings.title')}</h2>
        <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
          {t('settings.summary')}
        </p>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-[28px] border border-border/80 bg-background/80 p-5 shadow-sm">
          <div className="flex items-center gap-3 text-foreground">
            <ShieldCheck />
            <h3 className="text-lg font-semibold">{t('settings.secureBridge')}</h3>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">{t('settings.secureBridgeCopy')}</p>
        </article>

        <article className="rounded-[28px] border border-border/80 bg-background/80 p-5 shadow-sm">
          <div className="flex items-center gap-3 text-foreground">
            <FlaskConical />
            <h3 className="text-lg font-semibold">{t('settings.testMode')}</h3>
          </div>
          <p className="mt-3 text-sm text-muted-foreground" data-testid="settings-runtime-mode">
            {bootstrapQuery.data?.isTestMode
              ? t('settings.testModeEnabled')
              : t('common.standardMode')}
          </p>
          <p className="mt-3 break-all text-sm text-foreground" data-testid="settings-database-path">
            {t('settings.databasePath')}: {bootstrapQuery.data?.database.path}
          </p>
        </article>
      </section>
    </div>
  );
};