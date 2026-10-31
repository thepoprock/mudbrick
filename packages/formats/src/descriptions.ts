/**
 * Parser for DESCRIBE.TXT, the long in-game encyclopedia texts.
 *
 * Specification: docs/formats/textdata.md, "Family 5". Seven `@<CATEGORY>_DESCRIPTIONS`
 * sections. Each (except CONCEPT) opens with an `@@<CATEGORY>_INDEX` list that maps the
 * RULES.TXT row order onto the order of the `@@Title` entries that follow (the entries are
 * alphabetical, the rules are not): one integer per line with a trailing comma, `-1` = no
 * description for that rules row, `-2` = end of list. The file ends with a dummy header line
 * (`@This must be here to terminate search!!!`) that the original's search loop relies on.
 */
import { splitLines } from './text.js';

export type DescriptionCategory =
  'ADVANCE' | 'IMPROVEMENT' | 'WONDER' | 'UNIT' | 'TERRAIN_AND_RESOURCE' | 'GOVERNMENT' | 'CONCEPT';

export interface DescriptionEntry {
  title: string;
  /** Paragraph lines as written (long lines, no hard wrapping). */
  text: string[];
}

export interface DescriptionGroup {
  category: DescriptionCategory;
  /** rules row → entry index, or null when the file says −1. Empty for CONCEPT. */
  index: (number | null)[];
  entries: DescriptionEntry[];
}

export interface Descriptions {
  groups: Map<DescriptionCategory, DescriptionGroup>;
  warnings: string[];
}

const CATEGORY_HEADER = /^@([A-Z_]+)_DESCRIPTIONS\s*$/;
const INDEX_HEADER = /^@@[A-Z_]+_INDEX\s*$/;

export function parseDescriptions(text: string): Descriptions {
  const groups = new Map<DescriptionCategory, DescriptionGroup>();
  const warnings: string[] = [];
  let group: DescriptionGroup | undefined;
  let mode: 'none' | 'index' | 'entry' = 'none';
  let entry: DescriptionEntry | undefined;

  const finishEntry = () => {
    if (entry && group) {
      while (entry.text.length && entry.text[entry.text.length - 1] === '') entry.text.pop();
      group.entries.push(entry);
    }
    entry = undefined;
  };

  for (const raw of splitLines(text)) {
    const line = raw.trimEnd();
    if (line.startsWith(';')) continue;
    const cat = CATEGORY_HEADER.exec(line);
    if (cat) {
      finishEntry();
      const category = cat[1] as DescriptionCategory;
      group = { category, index: [], entries: [] };
      groups.set(category, group);
      mode = 'none';
      continue;
    }
    if (line.startsWith('@') && !line.startsWith('@@')) {
      // The terminator dummy header, or an unknown top-level section.
      finishEntry();
      group = undefined;
      mode = 'none';
      continue;
    }
    if (!group) continue;
    if (INDEX_HEADER.test(line)) {
      finishEntry();
      mode = 'index';
      continue;
    }
    if (line.startsWith('@@')) {
      finishEntry();
      entry = { title: line.slice(2).trim(), text: [] };
      mode = 'entry';
      continue;
    }
    if (mode === 'index') {
      const m = /^\s*(-?\d+)\s*,/.exec(line);
      if (!m) {
        if (line.trim() !== '')
          warnings.push(`@@${group.category}_INDEX: unexpected line "${line}"`);
        continue;
      }
      const n = Number(m[1]);
      if (n === -2) {
        mode = 'none';
        continue;
      }
      group.index.push(n === -1 ? null : n);
      continue;
    }
    if (mode === 'entry' && entry) {
      if (line === '' && entry.text.length === 0) continue;
      entry.text.push(line);
    }
  }
  finishEntry();

  for (const g of groups.values()) {
    for (const [row, i] of g.index.entries()) {
      if (i !== null && i >= g.entries.length) {
        warnings.push(
          `${g.category}: rules row ${row} points at entry ${i} but only ${g.entries.length} exist`,
        );
      }
    }
  }
  return { groups, warnings };
}

/** The description for a RULES.TXT row of the given category, or undefined. */
export function descriptionFor(
  d: Descriptions,
  category: DescriptionCategory,
  rulesRow: number,
): DescriptionEntry | undefined {
  const g = d.groups.get(category);
  if (!g) return undefined;
  const i = g.index[rulesRow];
  return i === null || i === undefined ? undefined : g.entries[i];
}
