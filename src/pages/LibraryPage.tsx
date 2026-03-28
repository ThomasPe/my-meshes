import { useTranslation } from 'react-i18next';

export default function LibraryPage(): React.JSX.Element {
  const { t } = useTranslation();

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-4"
      data-testid="library-page"
    >
      <h1 className="text-2xl font-bold">{t('library.title')}</h1>
      <p className="text-muted-foreground">{t('library.empty')}</p>
    </div>
  );
}
