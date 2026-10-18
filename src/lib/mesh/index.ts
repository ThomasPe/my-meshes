import { parseObj } from './obj';
import { parseStl } from './stl';
import { parse3mf } from './threemf';
import { PREVIEWABLE, type ParsedMesh } from './types';

export { PREVIEWABLE, extOf } from './types';
export type { ParsedMesh } from './types';

/** Dispatches on the file extension. Throws for formats without a parser. */
export function parseModel(buffer: ArrayBuffer, ext: string): ParsedMesh {
  switch (ext.toLowerCase()) {
    case 'stl': return parseStl(buffer);
    case 'obj': return parseObj(buffer);
    case '3mf': return parse3mf(buffer);
    default: throw new Error(`no parser for .${ext}`);
  }
}

export function canPreview(name: string): boolean {
  return PREVIEWABLE.has(name.split('.').pop()?.toLowerCase() ?? '');
}
