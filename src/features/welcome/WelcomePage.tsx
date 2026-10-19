import { Boxes, ChevronRight, FileText, FolderOpen, Images, Settings, Upload } from 'lucide-react';
import { useImport } from '@/features/import/useImport';
import { useTranslation } from 'react-i18next';
import { useLibraryActions } from '@/features/library/useLibraryActions';
import { routeHref } from '@/lib/router';

export function WelcomePage({ onScanEnd }: { onScanEnd: (rootId: string) => void }) {
  const { t } = useTranslation();
  const { addRootViaPicker } = useLibraryActions(onScanEnd);
  const pickImport = useImport((s) => s.pick);
  return (
    <main className="grid h-full place-items-center overflow-auto p-6" data-testid="welcome">
      <div className="grid w-full max-w-[560px] justify-items-center gap-5 text-center">
        <div className="grid size-20 place-items-center rounded-[26px] bg-primary text-primary-foreground"><Boxes className="size-10" /></div>
        <h1 className="text-3xl font-extrabold tracking-tight text-balance">{t('welcome.title')}</h1>
        <p className="max-w-[46ch] text-muted-foreground">{t('welcome.lead')}</p>
        <div className="mt-1 grid w-full gap-2.5 text-left">
          <button type="button" data-testid="welcome-add-root" onClick={() => void addRootViaPicker()} className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border-2 border-transparent bg-card p-4 shadow-card hover:border-primary focus-visible:border-primary focus-visible:outline-none">
            <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><FolderOpen className="size-5" /></span>
            <span><b className="block text-sm">{t('welcome.addRoot')}</b><span className="text-xs font-semibold text-muted-foreground">{t('welcome.addRootHint')}</span></span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
          <button type="button" data-testid="welcome-import" onClick={() => void pickImport()} className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border-2 border-transparent bg-card p-4 text-left shadow-card hover:border-primary focus-visible:border-primary focus-visible:outline-none">
            <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><Upload className="size-5" /></span>
            <span><b className="block text-sm">{t('welcome.import')}</b><span className="text-xs font-semibold text-muted-foreground">{t('welcome.importHint')}</span></span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
          <a href={routeHref({ page: 'settings' })} className="grid w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border-2 border-transparent bg-card p-4 shadow-card hover:border-primary">
            <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground"><Settings className="size-5" /></span>
            <span><b className="block text-sm">{t('welcome.settings')}</b><span className="text-xs font-semibold text-muted-foreground">{t('welcome.settingsHint')}</span></span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </a>
        </div>
        <div className="mt-2 grid w-full gap-2 text-left sm:grid-cols-3" data-testid="welcome-steps">
          {[{ icon: <FolderOpen className="size-4" />, k: 'scan' }, { icon: <Images className="size-4" />, k: 'thumbs' }, { icon: <FileText className="size-4" />, k: 'sidecar' }].map(({ icon, k }) => (
            <div key={k} className="grid gap-1 rounded-2xl bg-card/60 p-3"><span className="flex items-center gap-1.5 text-xs font-bold text-primary">{icon}{t(`welcome.steps.${k}.title`)}</span><span className="text-xs text-muted-foreground">{t(`welcome.steps.${k}.body`)}</span></div>
          ))}
        </div>
        <p className="text-xs font-semibold text-muted-foreground">{t('welcome.footer')}</p>
      </div>
    </main>
  );
}
