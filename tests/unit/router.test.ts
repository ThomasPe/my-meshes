import { describe, expect, it } from 'vitest';
import { parseRoute, routeHref } from '@/lib/router';

describe('router', () => {
  it('round-trips project ids with special characters', () => {
    const id = 'r1:Projects/Gridfinity/Rugged Box v2 (ü)';
    expect(parseRoute(routeHref({ page: 'project', id }))).toEqual({ page: 'project', id });
  });
  it('defaults to the library', () => {
    expect(parseRoute('')).toEqual({ page: 'library' });
    expect(parseRoute('#/nonsense')).toEqual({ page: 'library' });
    expect(parseRoute('#/settings')).toEqual({ page: 'settings' });
  });
});
