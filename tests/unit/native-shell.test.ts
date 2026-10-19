import { describe, expect, it } from 'vitest';
import { shouldBlockContextMenu, shouldBlockKey } from '@/lib/native-shell';

const el = (editable: boolean) => ({ closest: (sel: string) => (editable && sel.includes('input') ? {} : null) }) as unknown as EventTarget;

describe('native shell guards', () => {
  it('keeps the native menu for text fields only', () => {
    expect(shouldBlockContextMenu(el(true))).toBe(false);
    expect(shouldBlockContextMenu(el(false))).toBe(true);
    expect(shouldBlockContextMenu(null)).toBe(true);
  });
  it('blocks browser chrome shortcuts and nothing else', () => {
    const k = (key: string, o: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...o });
    expect(shouldBlockKey(k('F5'))).toBe(true);
    expect(shouldBlockKey(k('r', { ctrlKey: true }))).toBe(true);
    expect(shouldBlockKey(k('p', { ctrlKey: true }))).toBe(true);
    expect(shouldBlockKey(k('I', { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(shouldBlockKey(k('k', { ctrlKey: true }))).toBe(false); // app search
    expect(shouldBlockKey(k('a', { ctrlKey: true }))).toBe(false); // select all
    expect(shouldBlockKey(k('c', { ctrlKey: true }))).toBe(false);
    expect(shouldBlockKey(k('Delete'))).toBe(false);
    expect(shouldBlockKey(k('F2'))).toBe(false);
  });
});
