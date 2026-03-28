import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';

export default function HomePage(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6" data-testid="home-page">
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">{t('home.welcome')}</h1>
        <p className="mt-2 text-muted-foreground">{t('home.subtitle')}</p>
      </div>
      <Button onClick={() => navigate('/library')} data-testid="get-started-button">
        {t('home.getStarted')}
      </Button>
    </div>
  );
}
