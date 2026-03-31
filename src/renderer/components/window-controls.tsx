import type { CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/renderer/lib/cn';

const queryKey = ['window-state'] as const;

const controlClassName =
  'flex size-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground';

export const WindowControls = () => {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const windowStateQuery = useQuery({
    queryKey,
    queryFn: () => window.appApi.getWindowState(),
  });

  const applyAction = async (
    action: Parameters<typeof window.appApi.invokeWindowAction>[0],
  ) => {
    const nextState = await window.appApi.invokeWindowAction(action);
    queryClient.setQueryData(queryKey, nextState);
  };

  return (
    <div className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}>
      <button
        type="button"
        data-testid="window-control-minimize"
        aria-label={t('window.minimize')}
        className={controlClassName}
        onClick={() => void applyAction('minimize')}
      >
        <Minus />
      </button>
      <button
        type="button"
        data-testid="window-control-maximize"
        aria-label={
          windowStateQuery.data?.isMaximized
            ? t('window.restore')
            : t('window.maximize')
        }
        className={controlClassName}
        onClick={() => void applyAction('toggle-maximize')}
      >
        {windowStateQuery.data?.isMaximized ? <Copy /> : <Square />}
      </button>
      <button
        type="button"
        data-testid="window-control-close"
        aria-label={t('window.close')}
        className={cn(controlClassName, 'hover:bg-destructive/90 hover:text-destructive-foreground')}
        onClick={() => void applyAction('close')}
      >
        <X />
      </button>
    </div>
  );
};