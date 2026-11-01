import { readFileSync } from 'node:fs';
import { parseSave } from '@mudbrick/formats';
// Government scores of every civilization straight from a save: the civilization record is the
// in-memory record, so the seven scores sit at +0x3d4 (0x5d1694 − 0x5d12c0).
const file = process.argv[2] ?? '';
const bytes = new Uint8Array(readFileSync(file));
const save = parseSave(bytes);
const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
console.log(`turn ${save.parameters.turn}`);
for (let slot = 1; slot < 8; slot++) {
  const o = save.offsets.civs + save.offsets.civRecordSize * slot;
  const civ = save.civs[slot];
  if (!civ) continue;
  const scores = Array.from({ length: 7 }, (_, i) => dv.getInt16(o + 0x3d4 + i * 2, true));
  const extra = dv.getInt16(o + 0x3d2, true);
  const ncities = save.cities.filter((c) => c.owner === slot).length;
  const nunits = save.units.filter((u) => u.owner === slot).length;
  console.log(
    `slot ${slot} gov ${dv.getUint8(o + 0x15)} advances ${dv.getUint8(o + 0x10)} cities ${ncities} units ${nunits} scores ${scores.join(',')} +3d2 ${extra}`,
  );
}
