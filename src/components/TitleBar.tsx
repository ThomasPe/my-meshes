import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { Minus, Square, X, Copy, Home, FolderOpen, Settings } from 'lucide-react';

export default function TitleBar(): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMaximized, setIsMaximized] = useState(false);

  const handleMaximize = useCallback(async () => {
    await window.electronApi.windowMaximize();
    const maximized = await window.electronApi.windowIsMaximized();
    setIsMaximized(maximized);
  }, []);

  const navItems = [
    { path: '/', label: t('nav.home'), icon: Home },
    { path: '/library', label: t('nav.library'), icon: FolderOpen },
    { path: '/settings', label: t('nav.settings'), icon: Settings },
  ];

  return (
    <div
      className="flex h-10 items-center border-b border-border bg-background"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      data-testid="titlebar"
    >
      <div
        className="flex items-center gap-1 px-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {navItems.map((item) => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            data-testid={`nav-${item.path.replace('/', '') || 'home'}`}
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
              location.pathname === item.path
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
            }`}
          >
            <item.icon className="h-3.5 w-3.5" />
            {item.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="flex" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <button
          onClick={() => window.electronApi.windowMinimize()}
          className="flex h-10 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
          aria-label={t('titlebar.minimize')}
          data-testid="titlebar-minimize"
        >
          <Minus className="h-4 w-4" />
        </button>
        <button
          onClick={handleMaximize}
          className="flex h-10 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-accent"
          aria-label={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')}
          data-testid="titlebar-maximize"
        >
          {isMaximized ? <Copy className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => window.electronApi.windowClose()}
          className="flex h-10 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
          aria-label={t('titlebar.close')}
          data-testid="titlebar-close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
