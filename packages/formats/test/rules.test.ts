import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIRST_WONDER_INDEX, parseRules, UnitDomain, UnitRole } from '../src/rules.js';
import { decodeText } from '../src/text.js';
import { gameFile, hasGameFiles } from './helpers.js';

const cosmic = Array.from({ length: 22 }, (_, i) => `${i + 1}      ; constant ${i}`).join('\n');
const buildings = Array.from({ length: 39 }, (_, i) => `Building ${i}, 1, 0, nil,`).join('\n');

const MINI = `
@COSMIC
${cosmic}
@CIVILIZE
Alphabet,  5, 1, nil, nil, 0, 3   ; Alp
Writing,   6, 2, Alp, nil, 0, 3   ; Wri
Secret,    1, 0, no,  no,  0, 0   ; U1
@IMPROVE
${buildings}
Great Thing, 20, 0, Wri,
@ENDWONDER
:               0 = Ground
Alp,        ; Great Thing
@UNITS
Settlers,     Wri, 0,  1.,0,  0a,1d,  2h,1f,  4,0,  5, nil, 000000000000000
Trireme,      nil, 2,  3.,0,  1a,1d,  1h,1f,  4,2,  4, Alp, 000000000100000
@TERRAIN
Desert,     1,2,  0,1,0,   yes, 1, 5, 5,   yes, 1, 5,  3,  Pln,   ; Drt
Plains,     1,2,  1,1,0,   yes, 1, 5, 1,   no,  0,15,  0,  Drt,   ; Pln
Oasis,      1,2,  3,1,0,
Buffalo,    1,2,  1,3,0,
Desert Oil, 1,2,  0,4,0,
Wheat,      1,2,  3,1,0,
@GOVERNMENTS
Anarchy,        Mr.,         Ms.
@LEADERS
Caesar,       Livia,               0, 1, 1, Romans,      Roman,       0,  1,  1,     1, Dictator, Dictator, 2, Imperator, Imperatrix
Saladin,    ...,     0, 5, Arabs,       Arab,        1,  0,  1,     4, Ayatollah, Ayatollah
@CARAVAN
Hides,
@ORDERS
Fortify,            F
@DIFFICULTY
Chieftain
@ATTITUDES
Worshipful
`;

describe('parseRules (inline fixture)', () => {
  const r = parseRules(MINI);

  it('reads cosmic constants by position', () => {
    expect(r.cosmic.roadMoveMultiplier).toBe(1);
    // The fixture says 22; the original clamps this constant to 0–10 (0x00410603).
    expect(r.cosmic.fundamentalismMaxScienceRate).toBe(10);
  });

  it('resolves advance prerequisites through abbreviations', () => {
    expect(r.advances[1]?.preq1).toEqual({ kind: 'advance', index: 0 });
    expect(r.advances[2]?.preq1).toEqual({ kind: 'never' });
    expect(r.improvements[39]?.preq).toEqual({ kind: 'advance', index: 1 });
    expect(r.improvements[39]?.isWonder).toBe(true);
    expect(r.improvements[38]?.isWonder).toBe(false);
  });

  it('skips the malformed ENDWONDER and LEADERS rows with warnings', () => {
    expect(r.wonderExpiry).toEqual([
      { improvementIndex: FIRST_WONDER_INDEX, expiresWith: { kind: 'advance', index: 0 } },
    ]);
    expect(r.leaders).toHaveLength(1);
    expect(r.leaders[0]?.titles).toEqual([
      { governmentIndex: 1, male: 'Dictator', female: 'Dictator' },
      { governmentIndex: 2, male: 'Imperator', female: 'Imperatrix' },
    ]);
    expect(r.warnings).toHaveLength(2);
  });

  it('decodes unit fields and flags', () => {
    const t = r.units[1];
    expect(t?.domain).toBe(UnitDomain.Sea);
    expect(t?.role).toBe(UnitRole.SeaTransport);
    expect(t?.holds).toBe(2);
    expect(t?.flags.mustStayNearLand).toBe(true);
    expect(t?.flags.raw).toBe(1 << 5);
    expect(r.units[0]?.obsoleteWith).toEqual({ kind: 'advance', index: 1 });
  });

  it('pairs terrain specials with their base terrain (first list, then second list)', () => {
    expect(r.terrain[0]?.specials.map((s) => s.name)).toEqual(['Oasis', 'Desert Oil']);
    expect(r.terrain[1]?.specials.map((s) => s.name)).toEqual(['Buffalo', 'Wheat']);
    expect(r.terrain[1]?.transformTo).toEqual({ kind: 'becomes', terrainIndex: 0 });
    expect(r.terrain[0]?.mine).toEqual({ kind: 'yes' });
  });
});

describe.skipIf(!hasGameFiles)('parseRules (shipped RULES.TXT)', () => {
  const r = hasGameFiles ? parseRules(decodeText(gameFile('RULES.TXT'))) : undefined;

  it('has the documented table sizes', () => {
    expect(r?.advances).toHaveLength(100);
    expect(r?.improvements).toHaveLength(67);
    expect(r?.wonderExpiry).toHaveLength(28);
    expect(r?.units).toHaveLength(62);
    expect(r?.terrain).toHaveLength(11);
    expect(r?.governments).toHaveLength(7);
    expect(r?.leaders).toHaveLength(21);
    expect(r?.caravanCommodities).toHaveLength(16);
    expect(r?.orders).toHaveLength(11);
    expect(r?.difficulty).toHaveLength(6);
    expect(r?.attitudes).toHaveLength(9);
  });

  it('matches known values', () => {
    expect(r?.cosmic.roadMoveMultiplier).toBe(3);
    expect(r?.cosmic.aqueductSize).toBe(8);
    expect(r?.advances.find((a) => a.abbrev === 'Alp')?.name).toBe('Alphabet');
    expect(r?.improvements[1]?.name).toBe('Palace');
    expect(r?.improvements[39]?.name).toBe('Pyramids');
    expect(r?.improvements[66]?.name).toBe('Cure for Cancer');
    expect(r?.units[0]?.name).toBe('Settlers');
    expect(r?.units.find((u) => u.name === 'AEGIS Cruiser')?.flags.doubleDefenceVsAir).toBe(true);
    expect(r?.terrain[10]?.name).toBe('Ocean');
    expect(r?.terrain[10]?.specials.map((s) => s.name)).toEqual(['Fish', 'Whales']);
    expect(r?.leaders[0]?.plural).toBe('Romans');
    expect(r?.governments[6]?.name).toBe('Democracy');
  });

  it('pairs the shipped specials correctly', () => {
    expect(r?.terrain[0]?.specials.map((s) => s.name)).toEqual(['Oasis', 'Desert Oil']);
    expect(r?.terrain[3]?.specials.map((s) => s.name)).toEqual(['Pheasant', 'Silk']);
    expect(r?.terrain[9]?.specials.map((s) => s.name)).toEqual(['Gems', 'Fruit']);
  });

  it('warns only about the four known oddities of the shipped file', () => {
    // Two comment lines typed with ":" instead of ";" (one in @ENDWONDER, one in @UNITS)
    // and the two example leader rows (Saladin, Atawallpa) that are missing a field.
    expect(r?.warnings).toHaveLength(4);
    expect(r?.warnings.filter((w) => w.startsWith('@LEADERS'))).toHaveLength(2);
    expect(r?.warnings.filter((w) => w.startsWith('@ENDWONDER'))).toHaveLength(1);
    expect(r?.warnings.filter((w) => w.startsWith('@UNITS'))).toHaveLength(1);
  });
});

describe('leniency of the original loader', () => {
  it('reads a short @COSMIC, a non-number and an unknown prerequisite with warnings', () => {
    const short = MINI.replace(cosmic, cosmic.split('\n').slice(0, 21).join('\n'));
    const r = parseRules(short);
    expect(r.warnings.some((w) => w.includes('@COSMIC'))).toBe(true);
    const odd = MINI.replace('4      ; constant 3', '5      ; constant 3');
    expect(parseRules(odd).cosmic.foodBoxRows).toBe(6); // 5 is made even
    const bad = MINI.replace('Building 1, 1, 0, nil,', 'Building 1, Stones, 0, nil,');
    const rb = parseRules(bad);
    expect(rb.improvements[1]?.costRows).toBe(0);
    expect(rb.warnings.some((w) => w.includes('number expected'))).toBe(true);
    const unknown = MINI.replace('Building 1, 1, 0, nil,', 'Building 1, 1, 0, Zzz,');
    const ru = parseRules(unknown);
    expect(ru.improvements[1]?.preq).toEqual({ kind: 'never' });
    expect(ru.warnings.some((w) => w.includes('unknown advance'))).toBe(true);
  });

  const dir = process.env.ORIGINAL_GAME_DIR;
  it.skipIf(!dir)('parses every scenario RULES.TXT shipped with the game', () => {
    if (!dir) return;
    const scen = `${dir}/SCENARIO`;
    let n = 0;
    for (const sub of readdirSync(scen)) {
      const file = readdirSync(`${scen}/${sub}`).find((f) => f.toLowerCase() === 'rules.txt');
      if (!file) continue;
      const rules = parseRules(decodeText(new Uint8Array(readFileSync(`${scen}/${sub}/${file}`))));
      expect(rules.units.length).toBeGreaterThan(0);
      n += 1;
    }
    expect(n).toBeGreaterThan(15);
  });
});
