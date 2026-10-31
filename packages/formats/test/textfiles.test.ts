import { describe, expect, it } from 'vitest';
import { cityNamesFor, parseCityNames } from '../src/cityNames.js';
import { descriptionFor, parseDescriptions } from '../src/descriptions.js';
import { parseLabels } from '../src/labels.js';
import { parsePopups, substitutionTokens } from '../src/popups.js';
import { parseRules } from '../src/rules.js';
import { decodeText } from '../src/text.js';
import { gameFile, hasGameFiles } from './helpers.js';

describe('parsePopups (inline)', () => {
  const popups = parsePopups(
    [
      '; header comment',
      '@MAINMENU',
      '@width=200',
      '@title=Main',
      '@options',
      'Start a New Game',
      'Load a Game',
      '',
      '@HELLO',
      '@width=220',
      '@title=The World Turns...',
      '%STRING0, you may now command',
      'the %STRING1.',
      '@button=Later',
      '@listbox=5',
      'one',
      'two',
      '@frobnicate=3',
      '',
    ].join('\r\n'),
  );
  it('reads directives, text and entries', () => {
    const m = popups.get('MAINMENU');
    expect(m?.width).toBe(200);
    expect(m?.title).toBe('Main');
    expect(m?.entryKind).toBe('options');
    expect(m?.entries).toEqual(['Start a New Game', 'Load a Game']);
    expect(m?.text).toEqual([]);
    const h = popups.get('HELLO');
    expect(h?.text).toEqual(['%STRING0, you may now command', 'the %STRING1.']);
    expect(h?.buttons).toEqual(['Later']);
    expect(h?.entryKind).toBe('listbox');
    expect(h?.listboxRows).toBe(5);
    expect(h?.entries).toEqual(['one', 'two']);
    expect(h?.unknownDirectives).toEqual(['@frobnicate=3']);
    expect(h ? substitutionTokens(h) : []).toEqual(['%STRING0', '%STRING1']);
  });
});

describe('parseLabels / parseCityNames / parseDescriptions (inline)', () => {
  it('reads a label table and flags a count mismatch', () => {
    const l = parseLabels(
      '@STRINGHEAP\n500\n@POPUPS\nOK\nHelp\nCancel\nCustom\n@LABELS\n2\nB.C.\nA.D.\nextra\n',
    );
    expect(l.stringHeapSize).toBe(500);
    expect(l.buttons).toEqual(['OK', 'Help', 'Cancel', 'Custom']);
    expect(l.labels).toEqual(['B.C.', 'A.D.', 'extra']);
    expect(l.warnings).toHaveLength(1);
  });
  it('reads city names per civilization', () => {
    const c = parseCityNames(
      '; names\n@ROMANS\nRome\nVeii\n@ZULUS\nZimbabwe\nAnExtremelyLongCityName\n',
    );
    expect(cityNamesFor(c, 'Romans')).toEqual(['Rome', 'Veii']);
    expect(c.warnings).toHaveLength(1);
  });
  it('maps rules rows to alphabetical entries', () => {
    const d = parseDescriptions(
      [
        '@ADVANCE_DESCRIPTIONS',
        '@@ADVANCE_INDEX',
        '1,\t; Writing (rules row 0)',
        '0,\t; Alphabet (rules row 1)',
        '-1,\t; user slot',
        '-2,\t; terminator',
        '',
        '@@Alphabet',
        'Letters.',
        '',
        '@@Writing',
        'Words.',
        '@This must be here to terminate search!!!',
      ].join('\n'),
    );
    const g = d.groups.get('ADVANCE');
    expect(g?.index).toEqual([1, 0, null]);
    expect(g?.entries.map((e) => e.title)).toEqual(['Alphabet', 'Writing']);
    expect(descriptionFor(d, 'ADVANCE', 0)?.title).toBe('Writing');
    expect(descriptionFor(d, 'ADVANCE', 2)).toBeUndefined();
    expect(d.warnings).toEqual([]);
  });
});

describe.skipIf(!hasGameFiles)('text files (shipped)', () => {
  const read = (name: string) => decodeText(gameFile(name));

  it('popup files have the documented section counts', () => {
    expect(parsePopups(read('Game.txt')).size).toBe(700);
    expect(parsePopups(read('PEDIA.TXT')).size).toBe(83);
    expect(parsePopups(read('HELP.TXT')).size).toBe(36);
    expect(parsePopups(read('TUTORIAL.TXT')).size).toBe(31);
    expect(parsePopups(read('ADVICE.TXT')).size).toBe(5);
  });

  it('Game.txt uses no directive this parser does not know', () => {
    const unknown = [...parsePopups(read('Game.txt')).values()].flatMap((p) => p.unknownDirectives);
    expect(unknown).toEqual([]);
  });

  it('Game.txt main menu matches the spec sample', () => {
    const m = parsePopups(read('Game.txt')).get('MAINMENU');
    expect(m?.width).toBe(200);
    expect(m?.entries[0]).toBe('Start a New Game');
    expect(m?.entries).toHaveLength(8);
  });

  it('Labels.txt declares 873 strings and ships exactly 873', () => {
    const l = parseLabels(read('Labels.txt'));
    expect(l.stringHeapSize).toBe(50000);
    expect(l.declaredCount).toBe(873);
    expect(l.labels).toHaveLength(873);
    expect(l.labels.slice(0, 2)).toEqual(['B.C.', 'A.D.']);
    expect(l.warnings).toEqual([]);
  });

  it('CITY.TXT has a list for every civilization in the rules', () => {
    const rules = parseRules(read('RULES.TXT'));
    const names = parseCityNames(read('CITY.TXT'));
    expect(names.byCivilization.size).toBe(26);
    for (const leader of rules.leaders) {
      expect(cityNamesFor(names, leader.plural).length, leader.plural).toBeGreaterThan(0);
    }
    expect(cityNamesFor(names, 'Romans')[0]).toBe('Rome');
    expect(names.warnings).toEqual([]);
  });

  it('Describe.txt indexes line up with the rules tables', () => {
    const rules = parseRules(read('RULES.TXT'));
    const d = parseDescriptions(read('Describe.txt'));
    expect([...d.groups.keys()]).toEqual([
      'ADVANCE',
      'IMPROVEMENT',
      'WONDER',
      'UNIT',
      'TERRAIN_AND_RESOURCE',
      'GOVERNMENT',
      'CONCEPT',
    ]);
    expect(d.groups.get('ADVANCE')?.index).toHaveLength(rules.advances.length);
    expect(d.groups.get('IMPROVEMENT')?.index).toHaveLength(39);
    expect(d.groups.get('WONDER')?.index).toHaveLength(28);
    expect(d.groups.get('UNIT')?.index).toHaveLength(rules.units.length);
    expect(d.groups.get('TERRAIN_AND_RESOURCE')?.index).toHaveLength(33);
    expect(d.groups.get('GOVERNMENT')?.index).toHaveLength(rules.governments.length);
    expect(d.warnings).toEqual([]);
    const alphabet = rules.advances.findIndex((a) => a.abbrev === 'Alp');
    expect(descriptionFor(d, 'ADVANCE', alphabet)?.title).toBe('Alphabet');
    const settlers = rules.units.findIndex((u) => u.name === 'Settlers');
    expect(descriptionFor(d, 'UNIT', settlers)?.title).toBe('Settlers');
    expect(descriptionFor(d, 'ADVANCE', rules.advances.length - 1)).toBeUndefined(); // user slot
  });
});
