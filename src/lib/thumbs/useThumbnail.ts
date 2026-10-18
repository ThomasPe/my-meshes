// Resolves a thumbnail key to an object URL, with a small LRU so scrolling back and forth
// does not re-fetch. Bytes come through the backend (raw IPC), never via a file:// URL.
import { useEffect, useState } from 'react';
import { getBackend } from '@/lib/backend';

const MAX = 1500;
const cache = new Map<string, string>(); // key -> object URL, insertion order = LRU
const inflight = new Map<string, Promise<string>>();

function remember(key: string, url: string) {
  cache.delete(key);
  cache.set(key, url);
  while (cache.size > MAX) {
    const [oldKey, oldUrl] = cache.entries().next().value as [string, string];
    cache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
}

export function loadThumbnail(key: string): Promise<string> {
  const hit = cache.get(key);
  if (hit) { remember(key, hit); return Promise.resolve(hit); }
  let p = inflight.get(key);
  if (!p) {
    p = getBackend()
      .then((b) => b.readThumbnail(key))
      .then((bytes) => { const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); remember(key, url); return url; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** `null` while loading or when there is no key; the URL once the PNG is in memory. */
export function useThumbnail(key: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (key ? cache.get(key) ?? null : null));
  useEffect(() => {
    if (!key) { setUrl(null); return; }
    const hit = cache.get(key);
    if (hit) { setUrl(hit); return; }
    let alive = true;
    loadThumbnail(key).then((u) => { if (alive) setUrl(u); }).catch(() => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [key]);
  return url;
}

/** Test seam / cache clearing. */
export function dropThumbnailCache() {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}
