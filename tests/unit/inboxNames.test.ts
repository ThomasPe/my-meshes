import { describe, expect, it } from 'vitest';
import { commonPrefix, proposeName, stripPrefix } from '@/features/library/inboxNames';

describe('inbox names', () => {
  it('proposes a readable name from the file name', () => {
    expect(proposeName('Cinderwing3D Baby Rose -23.stl')).toBe('Cinderwing3D Baby Rose 23');
    expect(proposeName('cinderwing-whatisit.stl')).toBe('cinderwing whatisit');
    expect(proposeName('quick_download.3mf')).toBe('quick download');
  });
  it('finds the prefix most names share, on word boundaries only', () => {
    const names = ['Cinderwing3D Baby Rose 23', 'Cinderwing3D Baby Void Sea Dragon', 'Cinderwing3D Cinder Snake', 'cinderwing whatisit'];
    expect(commonPrefix(names)).toBe('Cinderwing3D');
    expect(commonPrefix(['Cinderwing3D Baby A', 'Cinderwing3D Baby B'])).toBe('Cinderwing3D Baby');
    expect(commonPrefix(['Alpha', 'Beta'])).toBeNull();
    expect(commonPrefix(['Only one'])).toBeNull();
    // shared by fewer than half: not worth a toggle
    expect(commonPrefix(['X a', 'X b', 'Y c', 'Z d', 'W e'])).toBeNull();
  });
  it('strips the prefix only where it applies and never leaves a name empty', () => {
    expect(stripPrefix('Cinderwing3D Baby Rose 23', 'Cinderwing3D')).toBe('Baby Rose 23');
    expect(stripPrefix('cinderwing whatisit', 'Cinderwing3D')).toBe('cinderwing whatisit');
    expect(stripPrefix('Cinderwing3D', 'Cinderwing3D')).toBe('Cinderwing3D');
    expect(stripPrefix('Cinderwing3D ', 'Cinderwing3D')).toBe('Cinderwing3D ');
  });
});
