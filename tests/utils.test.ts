import { describe, it, expect } from 'vitest';
import { cn } from '../src/lib/utils';

describe('cn utility', () => {
  it('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'extra')).toBe('base extra');
  });

  it('merges conflicting tailwind classes', () => {
    expect(cn('px-4', 'px-2')).toBe('px-2');
  });
});
