/**
 * Scenario events: the `events.txt` macro language of the original, parsed as its parser does
 * (0x004c42e6, VERIFIED line by line; docs/formats/events-format.md). The game reads the file
 * from the scenario's folder when a scenario is loaded and keeps the parsed records in memory;
 * nothing of it is in the scenario file itself.
 *
 * The text is read line by line (lines are trimmed; blank lines and anything that is not the
 * keyword looked for are skipped). `@IF` opens an event and names a trigger, `@THEN` opens the
 * actions, `@ENDIF` closes the event; `@BEGINEVENTS` … `@ENDEVENTS` bracket the list and
 * `@DEBUG` turns the parser's logging on. Keywords compare case-insensitively; a field is a
 * line that starts with its name and `=`, the rest of the line being the value. A line starting
 * with `@` where a field is expected is an illegal statement and rejects the whole file
 * (BADEVENTSFILE), as does an unknown name that leaves a field unsatisfied.
 */

export type TribeRef =
  | { kind: 'slot'; slot: number }
  | { kind: 'anybody' }
  | { kind: 'triggerAttacker' }
  /** TRIGGERDEFENDER and TRIGGERRECEIVER (the parser gives both the same code). */
  | { kind: 'triggerDefender' };

export type UnitRef = { kind: 'type'; type: number } | { kind: 'anyunit' };

/** 1 human, 2 computer, 4 either. */
export type NegotiatorType = 1 | 2 | 4;

export interface EventPoint {
  x: number;
  y: number;
}

export type EventTrigger =
  /** An `@IF` whose trigger never parsed (the original keeps the zero record; nothing fires it). */
  | { kind: 'none' }
  | { kind: 'unitKilled'; unit: UnitRef; attacker: TribeRef; defender: TribeRef }
  | { kind: 'cityTaken'; city: string; attacker: TribeRef; defender: TribeRef }
  | { kind: 'turn'; turn: number | 'every' }
  | { kind: 'turnInterval'; interval: number }
  | { kind: 'randomTurn'; denominator: number }
  | { kind: 'scenarioLoaded' }
  | { kind: 'noSchism'; defender: TribeRef }
  | { kind: 'receivedTechnology'; receiver: TribeRef; technology: number }
  | {
      kind: 'negotiation';
      talker: TribeRef;
      talkerType: NegotiatorType;
      listener: TribeRef;
      listenerType: NegotiatorType;
    };

export interface EventActions {
  /** Up to twenty lines. */
  text?: string[];
  moveUnit?: {
    unit: UnitRef;
    owner: TribeRef;
    /** Four corners: upper-left, upper-right, lower-right, lower-left. */
    rect: [EventPoint, EventPoint, EventPoint, EventPoint];
    moveTo: EventPoint;
    /** −2 = ALL. */
    numberToMove: number;
  };
  createUnit?: {
    unit: number;
    owner: TribeRef;
    veteran: boolean;
    /** The home city's name; `none` or any other unknown name means none. */
    homeCity: string;
    /** Up to ten, tried in order. */
    locations: EventPoint[];
  };
  changeMoney?: { receiver: TribeRef; amount: number };
  playWaveFile?: string;
  makeAggression?: { who: TribeRef; whom: TribeRef };
  justOnce: boolean;
  playCdTrack?: number;
  dontPlayWonders: boolean;
  changeTerrain?: { terrain: number; rect: [EventPoint, EventPoint, EventPoint, EventPoint] };
  destroyACivilization?: { whom: TribeRef };
  giveTechnology?: { receiver: TribeRef; technology: number };
}

export interface ScenarioEvent {
  trigger: EventTrigger;
  actions: EventActions;
  /** The names as written, for display. */
  names: Record<string, string>;
}

export interface EventNames {
  /** Tribe (civilization) names by slot 0–7, as the game's name table gives them. */
  tribes: (string | undefined)[];
  /** Unit type names by RULES @UNITS index. */
  units: string[];
}

export type EventsParse =
  | { ok: true; events: ScenarioEvent[]; log: string[] }
  | { ok: false; error: string; line: number; log: string[] };

const TRIBE_CODES: Record<string, TribeRef> = {
  ANYBODY: { kind: 'anybody' },
  TRIGGERATTACKER: { kind: 'triggerAttacker' },
  TRIGGERDEFENDER: { kind: 'triggerDefender' },
  TRIGGERRECEIVER: { kind: 'triggerDefender' },
};

/** A tribe name (0x004c2020): the three special names, else a slot whose name matches. */
export function resolveTribe(name: string, names: EventNames): TribeRef | null {
  const code = TRIBE_CODES[name.toUpperCase()];
  if (code) return code;
  for (let slot = 0; slot < 8; slot++) {
    const n = names.tribes[slot];
    if (n !== undefined && n.toUpperCase() === name.toUpperCase()) return { kind: 'slot', slot };
  }
  return null;
}

/** A unit name (0x004c2129): ANYUNIT, else a type whose name matches. */
export function resolveUnit(name: string, names: EventNames): UnitRef | null {
  if (name.toUpperCase() === 'ANYUNIT') return { kind: 'anyunit' };
  for (let t = 0; t < names.units.length; t++) {
    const n = names.units[t];
    if (n !== undefined && n.toUpperCase() === name.toUpperCase()) return { kind: 'type', type: t };
  }
  return null;
}

const startsDigit = (s: string) => s.length > 0 && s.charAt(0) >= '0' && s.charAt(0) <= '9';
const startsNumber = (s: string) => startsDigit(s) || s.charAt(0) === '-' || s.charAt(0) === '+';

class Cursor {
  lines: string[];
  i = 0;
  constructor(text: string) {
    this.lines = text.split(/\r?\n/).map((l) => l.replace(/[ \t]+$/, '').replace(/^[ \t]+/, ''));
  }
  next(): string | null {
    for (;;) {
      if (this.i >= this.lines.length) return null;
      const l = this.lines[this.i++] ?? '';
      if (l.length === 0 || l.startsWith(';')) continue;
      return l;
    }
  }
  /** The next line as written (TEXT keeps blank lines; a comment line is text too). */
  nextRaw(): string | null {
    if (this.i >= this.lines.length) return null;
    return this.lines[this.i++] ?? '';
  }
  /** The numbers of a line such as `73,33, 73,33` in order; more lines are read when short. */
  numbers(count: number): number[] | null {
    const out: number[] = [];
    while (out.length < count) {
      const l = this.next();
      if (l === null) return null;
      for (const m of l.match(/[-+]?\d+/g) ?? []) if (out.length < count) out.push(Number(m));
    }
    return out;
  }
}

/** The field prefixes the parser knows, compared case-insensitively over their length. */
function field(line: string, name: string): string | null {
  if (line.length < name.length) return null;
  if (line.slice(0, name.length).toUpperCase() !== name.toUpperCase()) return null;
  return line.slice(name.length);
}

export function parseEvents(text: string, names: EventNames): EventsParse {
  const log: string[] = [];
  const events: ScenarioEvent[] = [];
  const c = new Cursor(text);
  const fail = (error: string): EventsParse => ({ ok: false, error, line: c.i, log });
  let state: 'outside' | 'if' | 'then' | 'ended' = 'outside';
  let cur: ScenarioEvent | null = null;
  let trigger: EventTrigger | null = null;
  // Skip to @BEGINEVENTS (the section the loader asks for), if present.
  const start = c.lines.findIndex((l) => l.toUpperCase() === '@BEGINEVENTS');
  if (start >= 0) c.i = start + 1;
  for (;;) {
    const line = c.next();
    if (line === null) break;
    if (line.startsWith('@')) {
      const word = line.slice(1).toUpperCase();
      if (word === 'IF') {
        // VERIFIED: every @IF allocates a record and links it in at once, whatever follows.
        cur = {
          trigger: { kind: 'none' },
          actions: { justOnce: false, dontPlayWonders: false },
          names: {},
        };
        events.push(cur);
        trigger = null;
        state = 'if';
        continue;
      }
      if (state === 'ended') continue;
      if (word === 'THEN') {
        if (cur && trigger) cur.trigger = trigger;
        state = 'then';
      } else if (word === 'ENDIF') {
        if (cur && trigger) cur.trigger = trigger;
        else if (cur) log.push(`event at line ${c.i} has no trigger`);
        cur = null;
        state = 'ended';
      } else if (word === 'DEBUG') {
        log.push('debug on');
      } else if (word === 'ENDEVENTS') {
        break;
      }
      continue;
    }
    if (state === 'if' && cur) {
      const up = line.toUpperCase();
      const r = parseTrigger(up, c, names, cur, log);
      if (r === 'error') return fail(`illegal ${up} statement`);
      if (r) trigger = r;
      continue;
    }
    if (state === 'then' && cur) {
      const up = line.toUpperCase();
      const r = parseAction(up, c, names, cur, log);
      if (r === 'error') return fail(`illegal ${up} statement`);
      continue;
    }
  }
  return { ok: true, events, log };
}

/** Read fields until every required one is present; a `@` line is an illegal statement. */
function readFields(
  c: Cursor,
  required: string[],
  handle: (line: string) => boolean | 'error',
  have: Set<string>,
): 'ok' | 'error' | 'eof' {
  while (required.some((r) => !have.has(r))) {
    const line = c.next();
    if (line === null) return 'eof';
    if (line.startsWith('@')) return 'error';
    const r = handle(line);
    if (r === 'error') return 'error';
  }
  return 'ok';
}

function tribeField(
  line: string,
  name: string,
  names: EventNames,
  cur: ScenarioEvent,
  log: string[],
): TribeRef | null | undefined {
  const v = field(line, name);
  if (v === null) return undefined;
  const ref = resolveTribe(v, names);
  if (!ref) {
    log.push(`found ${name}${v} but ${v} is not valid`);
    return null;
  }
  cur.names[name.slice(0, -1)] = v;
  return ref;
}

function parseTrigger(
  up: string,
  c: Cursor,
  names: EventNames,
  cur: ScenarioEvent,
  log: string[],
): EventTrigger | null | 'error' {
  const have = new Set<string>();
  if (up === 'UNITKILLED') {
    let unit: UnitRef | null = null;
    let attacker: TribeRef | null = null;
    let defender: TribeRef | null = null;
    const r = readFields(
      c,
      ['unit', 'attacker', 'defender'],
      (line) => {
        const u = field(line, 'unit=');
        if (u !== null) {
          const ref = resolveUnit(u, names);
          // VERIFIED: ANYUNIT is not valid here (the unit must be a type).
          if (!ref || ref.kind === 'anyunit') log.push(`found unit=${u} but ${u} is not valid`);
          else {
            unit = ref;
            cur.names.unit = u;
            have.add('unit');
          }
          return true;
        }
        const a = tribeField(line, 'attacker=', names, cur, log);
        if (a !== undefined) {
          if (a) {
            attacker = a;
            have.add('attacker');
          }
          return true;
        }
        const d = tribeField(line, 'defender=', names, cur, log);
        if (d !== undefined) {
          if (d) {
            defender = d;
            have.add('defender');
          }
          return true;
        }
        return true;
      },
      have,
    );
    if (r !== 'ok') return 'error';
    if (!unit || !attacker || !defender) return 'error';
    return { kind: 'unitKilled', unit, attacker, defender };
  }
  if (up === 'NEGOTIATION') {
    let talker: TribeRef | null = null;
    let listener: TribeRef | null = null;
    let talkerType: NegotiatorType | null = null;
    let listenerType: NegotiatorType | null = null;
    const type = (v: string): NegotiatorType | null =>
      v.toUpperCase() === 'HUMAN'
        ? 1
        : v.toUpperCase() === 'COMPUTER'
          ? 2
          : v.toUpperCase() === 'HUMANORCOMPUTER'
            ? 4
            : null;
    const r = readFields(
      c,
      ['talker', 'talkertype', 'listener', 'listenertype'],
      (line) => {
        const tt = field(line, 'talkertype=');
        if (tt !== null) {
          const t = type(tt);
          if (t) {
            talkerType = t;
            have.add('talkertype');
          } else log.push(`found talkertype=${tt} but ${tt} is not valid`);
          return true;
        }
        const lt = field(line, 'listenertype=');
        if (lt !== null) {
          const t = type(lt);
          if (t) {
            listenerType = t;
            have.add('listenertype');
          } else log.push(`found listenertype=${lt} but ${lt} is not valid`);
          return true;
        }
        const t = tribeField(line, 'talker=', names, cur, log);
        if (t !== undefined) {
          if (t) {
            talker = t;
            have.add('talker');
          }
          return true;
        }
        const l = tribeField(line, 'listener=', names, cur, log);
        if (l !== undefined) {
          if (l) {
            listener = l;
            have.add('listener');
          }
          return true;
        }
        return true;
      },
      have,
    );
    if (r !== 'ok' || !talker || !listener || !talkerType || !listenerType) return 'error';
    return { kind: 'negotiation', talker, talkerType, listener, listenerType };
  }
  if (up === 'NOSCHISM') {
    let defender: TribeRef | null = null;
    const r = readFields(
      c,
      ['defender'],
      (line) => {
        const d = tribeField(line, 'defender=', names, cur, log);
        if (d !== undefined && d) {
          defender = d;
          have.add('defender');
        }
        return true;
      },
      have,
    );
    if (r !== 'ok' || !defender) return 'error';
    return { kind: 'noSchism', defender };
  }
  if (up === 'RECEIVEDTECHNOLOGY') {
    let receiver: TribeRef | null = null;
    let technology: number | null = null;
    const r = readFields(
      c,
      ['receiver', 'technology'],
      (line) => {
        const rv = tribeField(line, 'receiver=', names, cur, log);
        if (rv !== undefined) {
          if (rv) {
            receiver = rv;
            have.add('receiver');
          }
          return true;
        }
        const t = field(line, 'technology=');
        if (t !== null) {
          if (startsDigit(t)) {
            technology = parseInt(t, 10);
            have.add('technology');
          } else log.push(`found technology=${t} but ${t} is not valid`);
        }
        return true;
      },
      have,
    );
    if (r !== 'ok' || !receiver || technology === null) return 'error';
    return { kind: 'receivedTechnology', receiver, technology };
  }
  if (up === 'CITYTAKEN') {
    let city: string | null = null;
    let attacker: TribeRef | null = null;
    let defender: TribeRef | null = null;
    const r = readFields(
      c,
      ['city', 'attacker', 'defender'],
      (line) => {
        const a = tribeField(line, 'attacker=', names, cur, log);
        if (a !== undefined) {
          if (a) {
            attacker = a;
            have.add('attacker');
          }
          return true;
        }
        const d = tribeField(line, 'defender=', names, cur, log);
        if (d !== undefined) {
          if (d) {
            defender = d;
            have.add('defender');
          }
          return true;
        }
        const ct = field(line, 'city=');
        if (ct !== null) {
          city = ct;
          cur.names.city = ct;
          have.add('city');
        }
        return true;
      },
      have,
    );
    if (r !== 'ok' || city === null || !attacker || !defender) return 'error';
    return { kind: 'cityTaken', city, attacker, defender };
  }
  if (up === 'TURN') {
    for (;;) {
      const line = c.next();
      if (line === null) return 'error';
      if (line.startsWith('@')) return 'error';
      const v = field(line, 'turn=');
      if (v === null) continue;
      if (v.toUpperCase() === 'EVERY') return { kind: 'turn', turn: 'every' };
      if (startsNumber(v)) return { kind: 'turn', turn: parseInt(v, 10) };
      log.push(`found turn=${v} but ${v} is not valid`);
    }
  }
  if (up === 'TURNINTERVAL') {
    for (;;) {
      const line = c.next();
      if (line === null) return 'error';
      if (line.startsWith('@')) return 'error';
      const v = field(line, 'interval=');
      if (v === null) continue;
      if (startsNumber(v)) return { kind: 'turnInterval', interval: parseInt(v, 10) };
      log.push(`found interval=${v} but ${v} is not valid`);
    }
  }
  if (up === 'RANDOMTURN') {
    for (;;) {
      const line = c.next();
      if (line === null) return 'error';
      if (line.startsWith('@')) return 'error';
      const v = field(line, 'denominator=');
      if (v === null) continue;
      if (startsDigit(v)) {
        const d = parseInt(v, 10);
        // VERIFIED: a denominator outside 1 … 1000 rejects the file.
        if (d < 1 || d > 1000) return 'error';
        return { kind: 'randomTurn', denominator: d };
      }
      log.push(`found denominator=${v} but ${v} is not valid`);
    }
  }
  if (up === 'SCENARIOLOADED') return { kind: 'scenarioLoaded' };
  return null;
}

function rect(c: Cursor): [EventPoint, EventPoint, EventPoint, EventPoint] | null {
  const n = c.numbers(8);
  if (!n) return null;
  const p = (i: number): EventPoint => ({ x: n[i * 2] ?? 0, y: n[i * 2 + 1] ?? 0 });
  return [p(0), p(1), p(2), p(3)];
}

function parseAction(
  up: string,
  c: Cursor,
  names: EventNames,
  cur: ScenarioEvent,
  log: string[],
): true | null | 'error' {
  const a = cur.actions;
  const have = new Set<string>();
  if (up === 'TEXT') {
    const lines: string[] = [];
    for (;;) {
      const line = c.nextRaw();
      if (line === null) return 'error';
      if (line.toUpperCase() === 'ENDTEXT') break;
      if (line.startsWith('@')) return 'error';
      if (lines.length < 20) lines.push(line);
    }
    a.text = lines;
    return true;
  }
  if (up === 'CHANGETERRAIN') {
    let terrain: number | null = null;
    let r: [EventPoint, EventPoint, EventPoint, EventPoint] | null = null;
    const res = readFields(
      c,
      ['terraintype', 'maprect'],
      (line) => {
        const t = field(line, 'terraintype=');
        if (t !== null) {
          if (startsDigit(t)) {
            // VERIFIED: the range test `(-1 < t) || (t < 11)` lets every number through.
            terrain = parseInt(t, 10);
            have.add('terraintype');
          } else log.push(`found terraintype=${t} but ${t} is not valid`);
          return true;
        }
        if (line.toUpperCase() === 'MAPRECT') {
          r = rect(c);
          if (!r) return 'error';
          have.add('maprect');
        }
        return true;
      },
      have,
    );
    if (res !== 'ok' || terrain === null || !r) return 'error';
    a.changeTerrain = { terrain, rect: r };
    return true;
  }
  if (up === 'CREATEUNIT') {
    let unit: number | null = null;
    let owner: TribeRef | null = null;
    let veteran: boolean | null = null;
    let homeCity: string | null = null;
    const locations: EventPoint[] = [];
    const res = readFields(
      c,
      ['unit', 'owner', 'homecity', 'veteran', 'locations'],
      (line) => {
        const u = field(line, 'unit=');
        if (u !== null) {
          const ref = resolveUnit(u, names);
          if (!ref) log.push(`found unit=${u} but ${u} is not valid`);
          else {
            // VERIFIED: ANYUNIT passes the check here and makes unit type −2 (unusable).
            unit = ref.kind === 'type' ? ref.type : -2;
            cur.names.unit = u;
            have.add('unit');
          }
          return true;
        }
        const o = tribeField(line, 'owner=', names, cur, log);
        if (o !== undefined) {
          if (o) {
            owner = o;
            have.add('owner');
          }
          return true;
        }
        const v = field(line, 'veteran=');
        if (v !== null) {
          const w = v.toUpperCase();
          if (w === 'YES' || w === 'TRUE') {
            veteran = true;
            have.add('veteran');
          } else if (w === 'NO' || w === 'FALSE') {
            veteran = false;
            have.add('veteran');
          } else log.push(`found veteran=${v} but ${v} is not valid`);
          return true;
        }
        const h = field(line, 'homecity=');
        if (h !== null) {
          homeCity = h;
          have.add('homecity');
          return true;
        }
        if (line.toUpperCase() === 'LOCATIONS') {
          for (let i = 0; i < 10; i++) {
            const l = c.next();
            if (l === null) return 'error';
            if (startsNumber(l)) {
              const n = l.match(/[-+]?\d+/g) ?? [];
              locations.push({ x: Number(n[0] ?? 0), y: Number(n[1] ?? 0) });
            } else if (l.toUpperCase() === 'ENDLOCATIONS') break;
          }
          if (locations.length > 0) have.add('locations');
        }
        return true;
      },
      have,
    );
    if (res !== 'ok' || unit === null || !owner || veteran === null || homeCity === null)
      return 'error';
    a.createUnit = { unit, owner, veteran, homeCity, locations };
    return true;
  }
  if (up === 'CHANGEMONEY') {
    let receiver: TribeRef | null = null;
    let amount: number | null = null;
    const res = readFields(
      c,
      ['receiver', 'amount'],
      (line) => {
        const r = tribeField(line, 'receiver=', names, cur, log);
        if (r !== undefined) {
          if (r) {
            receiver = r;
            have.add('receiver');
          }
          return true;
        }
        const v = field(line, 'amount=');
        if (v !== null && startsNumber(v)) {
          amount = parseInt(v, 10);
          have.add('amount');
        }
        return true;
      },
      have,
    );
    if (res !== 'ok' || !receiver || amount === null) return 'error';
    a.changeMoney = { receiver, amount };
    return true;
  }
  if (up === 'JUSTONCE') {
    a.justOnce = true;
    return true;
  }
  if (up === 'DONTPLAYWONDERS') {
    a.dontPlayWonders = true;
    return true;
  }
  if (up === 'MAKEAGGRESSION') {
    let who: TribeRef | null = null;
    let whom: TribeRef | null = null;
    const res = readFields(
      c,
      ['who', 'whom'],
      (line) => {
        const wm = tribeField(line, 'whom=', names, cur, log);
        if (wm !== undefined) {
          if (wm) {
            whom = wm;
            have.add('whom');
          }
          return true;
        }
        const w = tribeField(line, 'who=', names, cur, log);
        if (w !== undefined && w) {
          who = w;
          have.add('who');
        }
        return true;
      },
      have,
    );
    if (res !== 'ok' || !who || !whom) return 'error';
    a.makeAggression = { who, whom };
    return true;
  }
  if (up === 'DESTROYACIVILIZATION') {
    let whom: TribeRef | null = null;
    const res = readFields(
      c,
      ['whom'],
      (line) => {
        const wm = tribeField(line, 'whom=', names, cur, log);
        if (wm !== undefined && wm) {
          whom = wm;
          have.add('whom');
        }
        return true;
      },
      have,
    );
    if (res !== 'ok' || !whom) return 'error';
    a.destroyACivilization = { whom };
    return true;
  }
  if (up === 'GIVETECHNOLOGY') {
    let receiver: TribeRef | null = null;
    let technology: number | null = null;
    const res = readFields(
      c,
      ['receiver', 'technology'],
      (line) => {
        const r = tribeField(line, 'receiver=', names, cur, log);
        if (r !== undefined) {
          if (r) {
            receiver = r;
            have.add('receiver');
          }
          return true;
        }
        const t = field(line, 'technology=');
        if (t !== null && startsDigit(t)) {
          technology = parseInt(t, 10);
          have.add('technology');
        }
        return true;
      },
      have,
    );
    if (res !== 'ok' || !receiver || technology === null) return 'error';
    a.giveTechnology = { receiver, technology };
    return true;
  }
  if (up === 'MOVEUNIT') {
    let unit: UnitRef | null = null;
    let owner: TribeRef | null = null;
    let r: [EventPoint, EventPoint, EventPoint, EventPoint] | null = null;
    let moveTo: EventPoint | null = null;
    let numberToMove: number | null = null;
    const res = readFields(
      c,
      ['unit', 'owner', 'maprect', 'moveto', 'numbertomove'],
      (line) => {
        const u = field(line, 'unit=');
        if (u !== null) {
          const ref = resolveUnit(u, names);
          if (!ref) log.push(`found unit=${u} but ${u} is not valid`);
          else {
            unit = ref;
            cur.names.unit = u;
            have.add('unit');
          }
          return true;
        }
        const o = tribeField(line, 'owner=', names, cur, log);
        if (o !== undefined) {
          if (o) {
            owner = o;
            have.add('owner');
          }
          return true;
        }
        if (line.toUpperCase() === 'MAPRECT') {
          r = rect(c);
          if (!r) return 'error';
          have.add('maprect');
          return true;
        }
        if (line.toUpperCase() === 'MOVETO') {
          const l = c.next();
          if (l === null) return 'error';
          if (startsNumber(l)) {
            const n = l.match(/[-+]?\d+/g) ?? [];
            moveTo = { x: Number(n[0] ?? 0), y: Number(n[1] ?? 0) };
            have.add('moveto');
          }
          return true;
        }
        const nm = field(line, 'numbertomove=');
        if (nm !== null) {
          if (startsDigit(nm)) {
            numberToMove = parseInt(nm, 10);
            have.add('numbertomove');
          } else if (nm.toUpperCase() === 'ALL') {
            numberToMove = -2;
            have.add('numbertomove');
          } else log.push(`found numbertomove=${nm} but ${nm} is not valid`);
        }
        return true;
      },
      have,
    );
    if (res !== 'ok' || !unit || !owner || !r || !moveTo || numberToMove === null) return 'error';
    a.moveUnit = { unit, owner, rect: r, moveTo, numberToMove };
    return true;
  }
  if (up === 'PLAYCDTRACK') {
    const n = c.numbers(1);
    if (!n) return 'error';
    const track = n[0] ?? 0;
    if (track > 0) a.playCdTrack = track;
    return true;
  }
  if (up === 'PLAYWAVEFILE') {
    const l = c.next();
    if (l === null) return 'error';
    a.playWaveFile = l;
    return true;
  }
  return null;
}
