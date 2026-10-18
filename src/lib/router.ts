import { useEffect, useState } from 'react';

export type Route = { page: 'welcome' } | { page: 'library' } | { page: 'project'; id: string } | { page: 'settings' };

export function parseRoute(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  if (h.startsWith('project/')) return { page: 'project', id: decodeURIComponent(h.slice('project/'.length)) };
  if (h === 'settings') return { page: 'settings' };
  if (h === 'welcome') return { page: 'welcome' };
  return { page: 'library' };
}

export function routeHref(r: Route): string {
  switch (r.page) {
    case 'project': return `#/project/${encodeURIComponent(r.id)}`;
    case 'settings': return '#/settings';
    case 'welcome': return '#/welcome';
    default: return '#/library';
  }
}

export function navigate(r: Route) {
  location.hash = routeHref(r);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
