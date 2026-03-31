import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanLibraryRoot } from './scanner';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('scanLibraryRoot', () => {
  it('indexes supported mesh files and ignores configured folders', async () => {
    const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'my-meshes-scan-'));
    tempDirectories.push(rootPath);

    await fs.mkdir(path.join(rootPath, 'Nested'), { recursive: true });
    await fs.mkdir(path.join(rootPath, '.git'), { recursive: true });
    await fs.mkdir(path.join(rootPath, '__MACOSX'), { recursive: true });
    await fs.writeFile(path.join(rootPath, 'base.stl'), 'solid base');
    await fs.writeFile(path.join(rootPath, 'Nested', 'part.obj'), 'o part');
    await fs.writeFile(path.join(rootPath, 'Nested', 'plate.3mf'), '3mf');
    await fs.writeFile(path.join(rootPath, '.git', 'ignored.stl'), 'ignored');
    await fs.writeFile(path.join(rootPath, '__MACOSX', 'ignored.obj'), 'ignored');
    await fs.writeFile(path.join(rootPath, 'notes.txt'), 'ignore me');

    const result = await scanLibraryRoot(rootPath);

    expect(result.status).toBe('online');
    expect(result.items.map((item) => item.relativePath)).toEqual([
      'base.stl',
      'Nested/part.obj',
      'Nested/plate.3mf',
    ]);
  });

  it('marks missing roots as offline without throwing', async () => {
    const result = await scanLibraryRoot(
      path.join(os.tmpdir(), `missing-root-${Date.now()}`),
    );

    expect(result).toEqual({
      status: 'offline',
      items: [],
    });
  });
});