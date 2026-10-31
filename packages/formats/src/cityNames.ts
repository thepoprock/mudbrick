/**
 * Parser for CITY.TXT, the default city names per civilization.
 *
 * Specification: docs/formats/textdata.md, "Family 4". One `@PLURAL` section per civilization
 * (upper-cased plural from RULES.TXT @LEADERS, e.g. `@ROMANS`), one name per line, at most 15
 * characters each according to the file's own header.
 */
import { splitSections } from './text.js';

export const MAX_CITY_NAME_LENGTH = 15;

export interface CityNames {
  /** Upper-cased civilization plural → names in order. */
  byCivilization: Map<string, string[]>;
  warnings: string[];
}

export function parseCityNames(text: string): CityNames {
  const byCivilization = new Map<string, string[]>();
  const warnings: string[] = [];
  for (const s of splitSections(text)) {
    const names = s.lines.map((l) => l.trimEnd()).filter((l) => l !== '' && !l.startsWith(';'));
    for (const n of names) {
      if (n.length > MAX_CITY_NAME_LENGTH) {
        warnings.push(`@${s.name}: "${n}" is longer than ${MAX_CITY_NAME_LENGTH} characters`);
      }
    }
    byCivilization.set(s.name, names);
  }
  return { byCivilization, warnings };
}

/** Names for a civilization by its RULES.TXT plural ("Romans" → section ROMANS). */
export function cityNamesFor(names: CityNames, plural: string): string[] {
  return names.byCivilization.get(plural.toUpperCase()) ?? [];
}
