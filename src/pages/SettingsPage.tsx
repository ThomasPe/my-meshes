import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

export default function SettingsPage(): React.JSX.Element {
  const { t } = useTranslation();

  const { data: appInfo } = useQuery({
    queryKey: ['app-info'],
    queryFn: () => window.electronApi.getAppInfo(),
  });

  return (
    <div className="p-6" data-testid="settings-page">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
      <div className="mt-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{t('settings.about')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {appInfo?.name} v{appInfo?.version}
          </p>
        </div>
      </div>
    </div>
  );
}
