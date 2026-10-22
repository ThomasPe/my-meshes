import { ChevronDown, ChevronRight, Folder, FolderInput, HardDrive } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useMove } from '@/features/library/useMove';
import { useFolderTree, useRoots } from '@/lib/queries';
import type { FolderNode, LibraryRoot } from '@/lib/types';
import { cn } from '@/lib/utils';

type Target = { id: string; title: string; rel_path: string };
type Dest = { rootId: string; rel: string };

/** "Move to…": pick a container folder of any root (or type a new sub-folder) for the projects. */
export function MoveDialog({ projects, onClose, onMoved }: { projects: Target[]; onClose: () => void; onMoved: () => void }) {
  const { t } = useTranslation();
  const roots = useRoots();
  const [dest, setDest] = useState<Dest | null>(null);
  const [sub, setSub] = useState('');
  const { run, pending } = useMove();
  const open = projects.length > 0;
  useEffect(() => { if (open) { setDest(null); setSub(''); } }, [open]);
  const online = useMemo(() => (roots.data ?? []).filter((r) => r.status !== 'offline'), [roots.data]);
  const subName = sub.trim();
  const target = dest ? { rootId: dest.rootId, rel: subName ? (dest.rel ? `${dest.rel}/${subName}` : subName) : dest.rel } : null;
  const rootName = (r: LibraryRoot) => r.path.split(/[\\/]/).filter(Boolean).pop() || r.path;
  const label = target ? `${rootName(online.find((r) => r.id === target.rootId)!)}${target.rel ? ` / ${target.rel.replaceAll('/', ' / ')}` : ''}` : '';
  const confirm = () => { if (!target) return; run(projects.map((p) => p.id), target.rootId, target.rel, label, onMoved); };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-[560px]" data-testid="move-dialog">
        <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); confirm(); }}>
          <DialogHeader>
            <DialogTitle>{t('actions.moveTitle', { count: projects.length, name: projects[0]?.title ?? '' })}</DialogTitle>
            <DialogDescription>{t('actions.moveBody')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[45vh] overflow-auto rounded-xl border border-border p-1" role="tree" data-testid="move-tree">
            {online.map((r) => <RootPick key={r.id} root={r} name={rootName(r)} dest={dest} setDest={setDest} exclude={projects.map((p) => p.id)} />)}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="move-sub">{t('actions.moveNewFolder')}</Label>
            <Input id="move-sub" value={sub} onChange={(e) => setSub(e.target.value)} placeholder={t('actions.moveNewFolderHint')} disabled={!dest} data-testid="move-subfolder" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!target || pending} data-testid="move-confirm"><FolderInput />{t('actions.moveConfirm')}{label ? `: ${label}` : ''}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RootPick({ root, name, dest, setDest, exclude }: { root: LibraryRoot; name: string; dest: Dest | null; setDest: (d: Dest) => void; exclude: string[] }) {
  const tree = useFolderTree(root.id);
  const [open, setOpen] = useState(true);
  const active = dest?.rootId === root.id && dest.rel === '';
  return (
    <div>
      <div className={cn('flex h-8 items-center gap-1 rounded-lg px-2 text-sm font-bold', active && 'bg-accent text-accent-foreground')} role="treeitem" aria-selected={active}>
        <button type="button" aria-label={open ? 'collapse' : 'expand'} className="rounded p-0.5 text-muted-foreground" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button>
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setDest({ rootId: root.id, rel: '' })} data-testid="move-root"><HardDrive className="size-4 text-muted-foreground" /><span className="truncate">{name}</span></button>
      </div>
      {open && (tree.data ?? []).map((n) => <FolderPick key={n.rel_path} node={n} depth={1} rootId={root.id} dest={dest} setDest={setDest} exclude={exclude} />)}
    </div>
  );
}

/** Containers only: a project folder cannot hold other projects, so project nodes are left out. */
function FolderPick({ node, depth, rootId, dest, setDest, exclude }: { node: FolderNode; depth: number; rootId: string; dest: Dest | null; setDest: (d: Dest) => void; exclude: string[] }) {
  const [open, setOpen] = useState(depth < 2);
  if (node.is_project || exclude.includes(`${rootId}:${node.rel_path}`)) return null;
  const kids = node.children.filter((c) => !c.is_project && !exclude.includes(`${rootId}:${c.rel_path}`));
  const active = dest?.rootId === rootId && dest.rel === node.rel_path;
  return (
    <div>
      <div className={cn('flex h-8 items-center gap-1 rounded-lg px-2 text-sm font-medium', active && 'bg-accent text-accent-foreground')} style={{ paddingLeft: 8 + depth * 14 }} role="treeitem" aria-selected={active}>
        {kids.length > 0 ? <button type="button" aria-label={open ? 'collapse' : 'expand'} className="rounded p-0.5 text-muted-foreground" onClick={() => setOpen((o) => !o)}>{open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}</button> : <span className="w-[18px] shrink-0" />}
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setDest({ rootId, rel: node.rel_path })} data-testid="move-folder" data-rel={node.rel_path}><Folder className="size-4 text-muted-foreground" /><span className="truncate">{node.name}</span></button>
      </div>
      {open && kids.map((c) => <FolderPick key={c.rel_path} node={c} depth={depth + 1} rootId={rootId} dest={dest} setDest={setDest} exclude={exclude} />)}
    </div>
  );
}
