import { Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function TagEditor({ tags, onChange, disabled, className }: { tags: string[]; onChange: (next: string[]) => void; disabled?: boolean; className?: string }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const v = draft.trim().toLowerCase();
    setDraft('');
    setAdding(false);
    if (v && !tags.includes(v)) onChange([...tags, v].sort());
  };
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} data-testid="tag-editor">
      {tags.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-secondary pl-2.5 pr-1 py-0.5 text-xs font-semibold text-secondary-foreground" data-testid="tag">
          {tag}
          <button type="button" disabled={disabled} aria-label={`remove ${tag}`} onClick={() => onChange(tags.filter((x) => x !== tag))} className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"><X className="size-3" /></button>
        </span>
      ))}
      {adding ? (
        <input autoFocus value={draft} data-testid="tag-input" placeholder={t('inspector.addTagPlaceholder')} className="h-6 w-32 rounded-full border border-ring bg-background px-2.5 text-xs outline-none" onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(''); setAdding(false); } }} />
      ) : (
        <button type="button" disabled={disabled} data-testid="tag-add" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-input px-2.5 py-0.5 text-xs font-semibold text-muted-foreground hover:border-ring hover:text-foreground disabled:opacity-40"><Plus className="size-3" />{t('inspector.addTag')}</button>
      )}
    </div>
  );
}
