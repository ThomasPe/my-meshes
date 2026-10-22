/**
 * Proposed project names for inbox files (IMP-3, "make separate projects"): the file stem
 * with separators turned into spaces, plus the common prefix downloads tend to carry
 * ("Cinderwing3D Baby Rose" and "Cinderwing3D Cinder Snake" share "Cinderwing3D").
 */
export function proposeName(file: string): string {
  return file.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The word-boundary prefix shared by most of the names (at least two and at least half of
 * them), longest first. `null` when nothing worth stripping is shared.
 */
export function commonPrefix(names: string[]): string | null {
  if (names.length < 2) return null;
  const counts = new Map<string, number>();
  for (const n of names) {
    const words = n.split(' ');
    for (let k = 1; k < words.length; k++) {
      const p = words.slice(0, k).join(' ');
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  let best: string | null = null, bestCount = 0;
  for (const [p, c] of counts) {
    if (c < 2 || c * 2 < names.length) continue;
    if (c > bestCount || (c === bestCount && p.length > (best?.length ?? 0))) { best = p; bestCount = c; }
  }
  return best;
}

export function stripPrefix(name: string, prefix: string | null): string {
  if (!prefix || !name.startsWith(prefix + ' ')) return name;
  const rest = name.slice(prefix.length + 1).trim();
  return rest || name;
}
