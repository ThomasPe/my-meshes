import { describe, expect, it } from 'vitest';
import en from '@/i18n/en.json';
import de from '@/i18n/de.json';

function flat(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? flat(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]));
}

describe('i18n resources', () => {
  it('German has every English key and no extras', () => {
    const a = flat(en).sort();
    const b = flat(de).sort();
    expect(b).toEqual(a);
  });
  it('placeholders match between languages', () => {
    const grab = (o: Record<string, unknown>) => Object.fromEntries(flat(o).map((k) => [k, (k.split('.').reduce<unknown>((acc, p) => (acc as Record<string, unknown>)[p], o) as string).match(/{{\w+}}/g)?.sort() ?? []]));
    expect(grab(de as Record<string, unknown>)).toEqual(grab(en as Record<string, unknown>));
  });
});
