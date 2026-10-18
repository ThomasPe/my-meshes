import { Boxes, LayoutGrid, Moon, Search, Settings, Sun } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { navigate, routeHref, type Route } from '@/lib/router';
import { applyTheme, loadTheme, useUi } from '@/lib/store';
import { cn } from '@/lib/utils';

export function TopBar({ route }: { route: Route }) {
  const { t } = useTranslation();
  const text = useUi((s) => s.text);
  const setText = useUi((s) => s.setText);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input.current?.focus(); input.current?.select(); }
      if (e.key === 'Escape' && document.activeElement === input.current) input.current?.blur();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const nav = (page: 'library' | 'settings', icon: React.ReactNode, label: string) => (
    <a href={routeHref({ page })} className={cn('inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13px] font-bold text-muted-foreground hover:bg-secondary hover:text-foreground', (route.page === page || (page === 'library' && (route.page === 'project' || route.page === 'welcome'))) && 'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground')} data-testid={`nav-${page}`}>
      {icon}<span>{label}</span>
    </a>
  );

  return (
    <header className="flex items-center gap-2 border-b border-border bg-panel px-4">
      <a href="#/library" className="mr-2 flex items-center gap-2.5 text-base font-extrabold tracking-tight text-foreground">
        <span className="grid size-7 place-items-center rounded-[9px] bg-primary text-primary-foreground"><Boxes className="size-4" /></span>
        <span>{t('app.name')}</span>
      </a>
      <nav className="flex gap-0.5">
        {nav('library', <LayoutGrid className="size-4" />, t('nav.library'))}
        {nav('settings', <Settings className="size-4" />, t('nav.settings'))}
      </nav>
      <label className="ml-auto flex h-9 w-[min(380px,34vw)] min-w-[160px] items-center gap-2.5 rounded-full border border-border bg-background px-3.5 text-muted-foreground focus-within:border-ring">
        <Search className="size-4 shrink-0" />
        <input ref={input} data-testid="search" type="search" value={text} placeholder={t('nav.search')} autoComplete="off" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" onChange={(e) => { setText(e.target.value); if (route.page !== 'library') navigate({ page: 'library' }); }} />
        <kbd className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">Ctrl K</kbd>
      </label>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('nav.theme')} aria-pressed={dark} data-testid="theme-toggle" onClick={() => { const next = dark ? 'light' : 'dark'; applyTheme(next); setDark(next === 'dark'); }}>
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('nav.theme')} ({loadTheme()})</TooltipContent>
      </Tooltip>
    </header>
  );
}
