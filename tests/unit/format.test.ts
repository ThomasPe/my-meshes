import { describe, expect, it } from 'vitest';
import { formatBytes, formatDate, formatDuration, initials } from '@/lib/format';

describe('format', () => {
  it('bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50_126_484)).toBe('47.8 MB');
    expect(formatBytes(145.6 * 1024 ** 3)).toBe('145.6 GB');
  });
  it('dates relative to now', () => {
    const now = new Date('2026-10-18T12:00:00Z');
    expect(formatDate('2026-10-18T08:00:00Z', 'en', now)).toBe('today');
    expect(formatDate('2026-10-17T08:00:00Z', 'de', now)).toBe('gestern');
    expect(formatDate('1970-01-01T00:00:00Z', 'en', now)).toBe('–');
  });
  it('durations and initials', () => {
    expect(formatDuration(340)).toBe('340 ms');
    expect(formatDuration(4120)).toBe('4.1 s');
    expect(initials('Zach Freedman')).toBe('ZF');
    expect(initials('')).toBe('?');
  });
});
