import { Check, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TagEditor } from '@/features/library/TagEditor';
import { reportError } from '@/lib/errors';
import { useUpdateMetadata } from '@/lib/queries';
import { isAppError, type Project, type UpdateMetadata } from '@/lib/types';

const LICENSES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC-BY-NC-SA-4.0', 'CC0-1.0', 'MIT', 'GPL-3.0', 'Personal use'];
const MATERIALS = ['PLA', 'PLA Silk', 'PETG', 'ABS', 'ASA', 'TPU', 'Resin'];
const NONE = '__none__';

export function MetadataForm({ project: p, onReload }: { project: Project; onReload: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateMetadata();
  const [form, setForm] = useState(() => toForm(p));
  const [conflict, setConflict] = useState<UpdateMetadata | null>(null);
  useEffect(() => { setForm(toForm(p)); }, [p.id, p.sidecar_stamp?.mtime_unix_nanos, p.sidecar_stamp?.size]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(toForm(p));

  const save = (force = false) => {
    const upd: UpdateMetadata = { title: form.title, creator: form.creator, license: form.license === NONE ? '' : form.license, source_url: form.source_url, description: form.description, tags: form.tags, recommended_material: form.material === NONE ? '' : form.material, supports_required: form.supports, notes: form.notes, expected_stamp: p.sidecar_stamp ?? null, force };
    update.mutate({ id: p.id, update: upd }, {
      onSuccess: () => { setConflict(null); toast.success(p.sidecar.state === 'missing' ? t('project.created') : t('project.saved')); },
      onError: (e) => { if (isAppError(e) && e.code === 'sidecar_conflict') setConflict(upd); else reportError(e); },
    });
  };

  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); save(); }} data-testid="metadata-form">
      <div className="flex items-center gap-2.5">
        <h2 className="text-base font-extrabold tracking-tight">{t('project.metadata')}</h2>
        {p.sidecar.state === 'ok' ? <Badge variant="success"><Check />{t('inspector.sidecarOk')}</Badge> : p.sidecar.state === 'malformed' ? <Badge variant="warning" title={p.sidecar.message}>{t('inspector.sidecarMalformed')}</Badge> : <Badge variant="outline">{t('inspector.sidecarMissing')}</Badge>}
      </div>
      <Field label={t('project.title')}><Input value={form.title} onChange={(e) => set('title', e.target.value)} data-testid="field-title" /></Field>
      <Field label={t('project.creator')}><Input value={form.creator} onChange={(e) => set('creator', e.target.value)} data-testid="field-creator" /></Field>
      <Field label={t('project.license')}>
        <Select value={form.license} onValueChange={(v) => set('license', v)}>
          <SelectTrigger className="w-full rounded-[10px] shadow-none" data-testid="field-license"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={NONE}>{t('inspector.notSet')}</SelectItem>{LICENSES.concat(form.license && !LICENSES.includes(form.license) && form.license !== NONE ? [form.license] : []).map((l) => <SelectItem key={l} value={l}>{l}</SelectItem>)}</SelectContent>
        </Select>
      </Field>
      <Field label={t('project.sourceUrl')}>
        <div className="flex gap-1.5"><Input value={form.source_url} placeholder="https://…" onChange={(e) => set('source_url', e.target.value)} />{form.source_url && <Button asChild variant="outline" size="icon"><a href={form.source_url} target="_blank" rel="noreferrer"><ExternalLink /></a></Button>}</div>
      </Field>
      <Field label={t('inspector.tags')}><TagEditor tags={form.tags} onChange={(tags) => set('tags', tags)} className="py-1" /></Field>
      <Field label={t('project.description')}><Textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('project.material')}>
          <Select value={form.material} onValueChange={(v) => set('material', v)}>
            <SelectTrigger className="w-full rounded-[10px] shadow-none"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value={NONE}>{t('project.any')}</SelectItem>{MATERIALS.concat(form.material && !MATERIALS.includes(form.material) && form.material !== NONE ? [form.material] : []).map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
          </Select>
        </Field>
        <Field label={t('project.supportsRequired')}><div className="flex h-9 items-center"><Switch checked={form.supports} onCheckedChange={(v) => set('supports', v)} /></div></Field>
      </div>
      <Field label={t('project.notes')}><Input value={form.notes} placeholder="0.2 mm, 15 % infill…" onChange={(e) => set('notes', e.target.value)} /></Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!dirty || update.isPending || p.offline} data-testid="save-metadata"><Check />{t('project.save')}</Button>
        <span className="text-xs text-muted-foreground">{t('project.saveHint')}</span>
      </div>

      <Dialog open={!!conflict} onOpenChange={(o) => !o && setConflict(null)}>
        <DialogContent data-testid="conflict-dialog">
          <DialogHeader><DialogTitle>{t('project.conflictTitle')}</DialogTitle><DialogDescription>{t('project.conflictBody')}</DialogDescription></DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConflict(null); onReload(); }}>{t('project.reload')}</Button>
            <Button variant="destructive" onClick={() => save(true)}>{t('project.overwrite')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>
  );
}

function toForm(p: Project) {
  return { title: p.title, creator: p.creator ?? '', license: p.license ?? NONE, source_url: p.source_url ?? '', description: p.description ?? '', tags: p.tags, material: p.material ?? NONE, supports: p.supports_required ?? false, notes: '' };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="grid gap-1.5"><Label>{label}</Label>{children}</div>;
}
