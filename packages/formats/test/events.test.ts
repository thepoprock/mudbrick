import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeText } from '../src/text.js';
import { parseEvents, type EventNames } from '../src/events.js';

const dir = process.env.ORIGINAL_GAME_DIR;
const names: EventNames = {
  tribes: [
    'Barbarians',
    'Federals',
    'Confederates',
    'Mexicans',
    'French',
    'Indians',
    'Spanish',
    'British',
  ],
  units: ['Settlers', 'Engineers', 'Infantry', 'C Raiders', 'Block. Runner', 'Ironclad'],
};

describe('the events macro language', () => {
  it('parses triggers, fields, text, rectangles and locations as the original does', () => {
    const r = parseEvents(
      `
@BEGINEVENTS
@IF
SCENARIOLOADED
@THEN
PLAYCDTRACK
11
DONTPLAYWONDERS
@ENDIF

@IF
CITYTAKEN
city=Kansas City
attacker=federals
defender=Anybody
@THEN
TEXT
A line.

ENDTEXT
CREATEUNIT
unit=C Raiders
owner=Confederates
veteran=no
homecity=none
locations
8,60
10,70
endlocations
JUSTONCE
@ENDIF

@IF
TURN
turn=Every
@THEN
MOVEUNIT
unit=anyunit
owner=TriggerAttacker
maprect
73,33, 75,33, 75,36, 73,36
moveto
71,35
numbertomove=ALL
CHANGEMONEY
receiver=Federals
amount=-50
@ENDIF
@ENDEVENTS
`,
      names,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events).toHaveLength(3);
    expect(r.events[0]?.trigger).toEqual({ kind: 'scenarioLoaded' });
    expect(r.events[0]?.actions.playCdTrack).toBe(11);
    expect(r.events[0]?.actions.dontPlayWonders).toBe(true);
    const e1 = r.events[1];
    expect(e1?.trigger).toEqual({
      kind: 'cityTaken',
      city: 'Kansas City',
      attacker: { kind: 'slot', slot: 1 },
      defender: { kind: 'anybody' },
    });
    expect(e1?.actions.text).toEqual(['A line.', '']);
    expect(e1?.actions.createUnit).toEqual({
      unit: 3,
      owner: { kind: 'slot', slot: 2 },
      veteran: false,
      homeCity: 'none',
      locations: [
        { x: 8, y: 60 },
        { x: 10, y: 70 },
      ],
    });
    expect(e1?.actions.justOnce).toBe(true);
    const e2 = r.events[2];
    expect(e2?.trigger).toEqual({ kind: 'turn', turn: 'every' });
    expect(e2?.actions.moveUnit?.unit).toEqual({ kind: 'anyunit' });
    expect(e2?.actions.moveUnit?.owner).toEqual({ kind: 'triggerAttacker' });
    expect(e2?.actions.moveUnit?.rect[2]).toEqual({ x: 75, y: 36 });
    expect(e2?.actions.moveUnit?.numberToMove).toBe(-2);
    expect(e2?.actions.changeMoney).toEqual({ receiver: { kind: 'slot', slot: 1 }, amount: -50 });
  });

  it('rejects a file with a directive where a field belongs, or a bad denominator', () => {
    const bad = parseEvents('@IF\nUNITKILLED\nunit=Infantry\n@THEN\n@ENDIF\n', names);
    expect(bad.ok).toBe(false);
    const den = parseEvents('@IF\nRANDOMTURN\ndenominator=5000\n@THEN\n@ENDIF\n', names);
    expect(den.ok).toBe(false);
    const unit = parseEvents(
      '@IF\nUNITKILLED\nunit=anyunit\nattacker=Anybody\ndefender=Anybody\n@THEN\n@ENDIF\n',
      names,
    );
    expect(unit.ok).toBe(false);
  });

  it.skipIf(!dir)('parses every events file shipped with the game', () => {
    if (!dir) return;
    const scen = `${dir}/SCENARIO`;
    if (!existsSync(scen)) return;
    let files = 0;
    let events = 0;
    let blocks = 0;
    for (const sub of readdirSync(scen)) {
      const folder = `${scen}/${sub}`;
      const file = readdirSync(folder).find((f) => f.toLowerCase() === 'events.txt');
      if (!file) continue;
      // The scenario's own civilization names are not known without its save; the shipped
      // files all parse with the rules' tribe names plus the names the scenario uses, which
      // the lenient resolver below accepts (an unknown tribe becomes slot 7).
      const text = decodeText(new Uint8Array(readFileSync(`${folder}/${file}`)));
      // A scenario's own RULES.TXT names its units; some of those files use advance names our
      // rules parser does not accept yet, so the unit names are read off its @UNITS lines.
      const unitNames = (() => {
        const r = readdirSync(folder).find((f) => f.toLowerCase() === 'rules.txt');
        const src = decodeText(
          new Uint8Array(readFileSync(r ? `${folder}/${r}` : `${dir}/RULES.TXT`)),
        );
        const lines = src.split(/\r?\n/);
        const at = lines.findIndex((l) => l.trim().toUpperCase() === '@UNITS');
        const out: string[] = [];
        for (let i = at + 1; i < lines.length; i++) {
          const l = lines[i] ?? '';
          if (l.startsWith('@')) break;
          if (l.trim() === '' || l.startsWith(';')) continue;
          out.push((l.split(',')[0] ?? '').trim());
        }
        return out;
      })();
      const tribeNames = new Set<string>();
      for (const m of text.matchAll(
        /^(?:attacker|defender|owner|receiver|talker|listener|who|whom)=(.+)$/gim,
      ))
        tribeNames.add((m[1] ?? '').trim());
      const known = ['ANYBODY', 'TRIGGERATTACKER', 'TRIGGERDEFENDER', 'TRIGGERRECEIVER'];
      const tribes = [...tribeNames].filter((n) => !known.includes(n.toUpperCase())).slice(0, 8);
      const r = parseEvents(text, {
        tribes: ['Barbarians', ...tribes],
        units: unitNames,
      });
      expect(r.ok, `${sub}: ${r.ok ? '' : r.error}`).toBe(true);
      // Every @IF is a record, as in the original (a few shipped files have a stray one).
      const ifs = (text.match(/^\s*@IF\s*$/gim) ?? []).length;
      if (r.ok) expect(r.events.length, sub).toBe(ifs);
      if (r.ok) events += r.events.length;
      blocks += ifs;
      files += 1;
    }
    expect(files).toBeGreaterThan(10);
    expect(events).toBe(blocks);
    expect(events).toBeGreaterThan(400);
  });
});
