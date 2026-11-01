/**
 * The picture resources in the game's DLLs: a Windows PE file with a `GIFS` resource type whose
 * entries are plain GIF files, keyed by number. Specification: docs/formats/assets.md.
 */

export function dllGifs(bytes: Uint8Array): Map<number, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pe = view.getUint32(0x3c, true);
  const sections = view.getUint16(pe + 6, true);
  const optional = view.getUint16(pe + 20, true);
  const table: { va: number; size: number; raw: number }[] = [];
  for (let i = 0; i < sections; i++) {
    const o = pe + 24 + optional + 40 * i;
    const size = Math.max(view.getUint32(o + 8, true), view.getUint32(o + 16, true));
    table.push({ va: view.getUint32(o + 12, true), size, raw: view.getUint32(o + 20, true) });
  }
  const offset = (rva: number): number => {
    for (const s of table) if (rva >= s.va && rva < s.va + s.size) return rva - s.va + s.raw;
    throw new Error('bad resource address');
  };
  const root = offset(view.getUint32(pe + 24 + 96 + 8 * 2, true));
  const entries = (o: number) => {
    const n = view.getUint16(o + 12, true) + view.getUint16(o + 14, true);
    const out: { id: number; to: number }[] = [];
    for (let i = 0; i < n; i++)
      out.push({
        id: view.getUint32(o + 16 + 8 * i, true),
        to: view.getUint32(o + 20 + 8 * i, true),
      });
    return out;
  };
  const gifs = new Map<number, Uint8Array>();
  for (const type of entries(root)) {
    if (type.id < 0x80000000) continue;
    const name = root + (type.id & 0x7fffffff);
    const length = view.getUint16(name, true);
    let label = '';
    for (let i = 0; i < length; i++)
      label += String.fromCharCode(view.getUint16(name + 2 + 2 * i, true));
    if (label !== 'GIFS') continue;
    for (const item of entries(root + (type.to & 0x7fffffff))) {
      const lang = entries(root + (item.to & 0x7fffffff))[0];
      if (!lang) continue;
      const data = root + lang.to;
      const at = offset(view.getUint32(data, true));
      gifs.set(item.id, bytes.subarray(at, at + view.getUint32(data + 4, true)));
    }
  }
  return gifs;
}
