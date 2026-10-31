/**
 * Parser for the "popup" family of text files: GAME.TXT, PEDIA.TXT, HELP.TXT, TUTORIAL.TXT,
 * ADVICE.TXT, DEBUG.TXT, HERALD.TXT, COUNCIL*.TXT and scenario text files.
 *
 * Specification: docs/formats/textdata.md, "Family 1". Each `@NAME` section describes one
 * dialog: lower-case `@directives` set its geometry and controls, plain lines are its message,
 * and lines after `@options` are the selectable entries. `%STRING0`-style tokens are filled in
 * by the engine at display time and are kept verbatim here.
 */
import { splitSections } from './text.js';

export interface Popup {
  name: string;
  /** 1-based line of the `@NAME` header in the source file. */
  line: number;
  title?: string;
  width?: number;
  height?: number;
  columns?: number;
  /** Pre-selected option index. */
  defaultOption?: number;
  x?: number;
  y?: number;
  /** Entries become radio options (`@options`), a list box (`@listbox`) or check boxes (`@checkbox`). */
  entryKind?: 'options' | 'listbox' | 'checkbox';
  /** Visible rows when `@listbox=N` was given. */
  listboxRows?: number;
  /** Extra buttons in order (`@button=`). */
  buttons: string[];
  /** Message lines before the entries. `^` prefixes are kept (see spec: `^` indent, `^^` centre). */
  text: string[];
  /** The selectable entries, if any. */
  entries: string[];
  /** Directives this parser did not recognise, for the spec to catch up on. */
  unknownDirectives: string[];
}

const DIRECTIVE = /^@([a-z]+)(?:=(.*))?$/;

export function parsePopups(text: string): Map<string, Popup> {
  const out = new Map<string, Popup>();
  for (const section of splitSections(text)) {
    const p: Popup = {
      name: section.name,
      line: section.startLine,
      buttons: [],
      text: [],
      entries: [],
      unknownDirectives: [],
    };
    let inEntries = false;
    for (const raw of section.lines) {
      const line = raw.trimEnd();
      if (line.startsWith(';')) continue; // comment lines occur only at file top, but be safe
      const m = DIRECTIVE.exec(line);
      if (m) {
        const key = m[1] ?? '';
        const value = m[2];
        switch (key) {
          case 'title':
            p.title = value ?? '';
            break;
          case 'width':
            p.width = Number(value);
            break;
          case 'height':
            p.height = Number(value);
            break;
          case 'columns':
            p.columns = Number(value);
            break;
          case 'default':
            p.defaultOption = Number(value);
            break;
          case 'x':
            p.x = Number(value);
            break;
          case 'y':
            p.y = Number(value);
            break;
          case 'button':
            p.buttons.push(value ?? '');
            break;
          case 'options':
            p.entryKind = 'options';
            inEntries = true;
            break;
          case 'listbox':
            p.entryKind = 'listbox';
            if (value !== undefined && value !== '') p.listboxRows = Number(value);
            inEntries = true;
            break;
          case 'checkbox':
            p.entryKind = 'checkbox';
            inEntries = true;
            break;
          default:
            p.unknownDirectives.push(line);
        }
        continue;
      }
      if (line === '' && !inEntries) {
        // Blank lines separate sections visually; keep interior blanks of a message, drop trailing.
        p.text.push('');
        continue;
      }
      if (line === '') continue;
      (inEntries ? p.entries : p.text).push(line);
    }
    while (p.text.length > 0 && p.text[p.text.length - 1] === '') p.text.pop();
    while (p.text.length > 0 && p.text[0] === '') p.text.shift();
    out.set(p.name, p);
  }
  return out;
}

/** Substitution tokens the engine must fill: `%STRING0` … `%STRING6`, `%NUMBER0` … `%NUMBER5`. */
export function substitutionTokens(popup: Popup): string[] {
  const found = new Set<string>();
  for (const line of [...popup.text, ...popup.entries, popup.title ?? '']) {
    for (const m of line.matchAll(/%(?:STRING|NUMBER)\d/g)) found.add(m[0]);
  }
  return [...found].sort();
}
