import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeText } from '../src/text.js';
import {
  eventsFromRecords,
  parseEvents,
  recordsFromEvents,
  type EventNames,
  type ScenarioEvent,
} from '../src/events.js';
import { parseSave, readEventBlock } from '../src/save.js';
import { encodeEventBlock, patchFromSave, writeSave } from '../src/saveWriter.js';

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

const SAMPLE = `
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
`;

const strip = (e: ScenarioEvent) => ({ trigger: e.trigger, actions: e.actions });

describe('the events macro language', () => {
  it('parses triggers, fields, text, rectangles and locations as the original does', () => {
    const r = parseEvents(SAMPLE, names);
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

  it('round-trips events through the EVNT record layout and its byte encoding', () => {
    const parsed = parseEvents(SAMPLE, names);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const records = recordsFromEvents(parsed.events, undefined, names);
    expect(records[1]?.ints[0]).toBe(2); // CITYTAKEN
    expect(records[1]?.strings[4]).toBe('Kansas City');
    expect(records[1]?.strings[5]).toBe('Federals');
    expect(records[1]?.ints[9]).toBe(-2); // defender=Anybody
    expect((records[2]?.ints[1] ?? 0) & 0x2000).toBe(0);
    const back = eventsFromRecords(records);
    expect(back.events.map(strip)).toEqual(parsed.events.map(strip));
    expect(back.state.fired).toEqual([false, false, false]);
    // A fired JUSTONCE event and a written-over ANYBODY survive the trip.
    const state = {
      fired: [false, true, false],
      attacker: [0, 1, 0],
      defender: [0, 5, 0],
      receiver: [0, 5, 0],
    };
    const again = eventsFromRecords(recordsFromEvents(parsed.events, state, names));
    expect(again.state.fired[1]).toBe(true);
    expect(again.state.defender[1]).toBe(5);
    expect(again.events[1]?.trigger).toMatchObject({ defender: { kind: 'slot', slot: 5 } });
    // Bytes: tag, count, 444-byte records, then the strings.
    const bytes = encodeEventBlock(records);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('EVNT');
    expect(new DataView(bytes.buffer).getInt32(4, true)).toBe(3);
    const read = readEventBlock(bytes, 0, []);
    expect(read).toEqual(records);
  });

  it.skipIf(!dir)('a scenario file takes an EVNT block and gives it back', () => {
    if (!dir) return;
    const scen = `${dir}/SCENARIO`;
    const folder = readdirSync(scen).find((s) =>
      readdirSync(`${scen}/${s}`).some((f) => f.toUpperCase().endsWith('.SCN')),
    );
    if (!folder) return;
    const file = readdirSync(`${scen}/${folder}`).find((f) => f.toUpperCase().endsWith('.SCN'));
    const bytes = new Uint8Array(readFileSync(`${scen}/${folder}/${file}`));
    const save = parseSave(bytes);
    expect(save.events).toBeNull();
    const parsed = parseEvents(SAMPLE, names);
    if (!parsed.ok) return;
    const records = recordsFromEvents(parsed.events, undefined, names);
    const withEvents = writeSave(bytes, save, { ...patchFromSave(save), events: records });
    const reread = parseSave(withEvents);
    expect(reread.events).toEqual(records);
    expect(reread.warnings.filter((w) => w.includes('EVNT'))).toEqual([]);
    // Omitting the field keeps the block; null drops it.
    expect(parseSave(writeSave(withEvents, reread, patchFromSave(reread))).events).toEqual(records);
    const dropped = parseSave(
      writeSave(withEvents, reread, { ...patchFromSave(reread), events: null }),
    );
    expect(dropped.events).toBeNull();
    expect(dropped.hasEvents).toBe(false);
  });
});
