export function formatBytes(bytes: number, locale = 'en'): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toLocaleString(locale, { maximumFractionDigits: v >= 100 && i < 2 ? 0 : 1 })} ${units[i]}`;
}

export function formatDate(iso: string, locale = 'en', now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return '–';
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 864e5);
  if (diffDays === 0 && now.toDateString() === d.toDateString()) return locale.startsWith('de') ? 'heute' : 'today';
  if (diffDays === 1) return locale.startsWith('de') ? 'gestern' : 'yesterday';
  return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).map((w) => w[0]!).join('').slice(0, 2).toUpperCase() || '?';
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
