/**
 * The optional CITYPREF.TXT beside the game (read by 0x00474d90 each time a player turns on a
 * city's Auto button). VERIFIED there: a section @NODEFEND merely has to exist; a section
 * @AUTOBUILD lists improvements, one to a line with the name ending at a comma, matched without
 * regard to case against improvements 1 to 38. The list ends at the first unknown name, a blank
 * line, or the thirty-second entry.
 */
export interface CityPreferences {
  noDefend: boolean;
  autoBuild: number[];
}

export function parseCityPreferences(
  text: string,
  improvementName: (index: number) => string | undefined,
): CityPreferences {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const section = (name: string) => lines.findIndex((l) => l.toUpperCase() === `@${name}`);
  const prefs: CityPreferences = { noDefend: section('NODEFEND') >= 0, autoBuild: [] };
  const start = section('AUTOBUILD');
  if (start < 0) return prefs;
  for (let i = start + 1; i < lines.length && prefs.autoBuild.length < 32; i++) {
    const wanted = (lines[i] ?? '').split(',')[0]?.trim().toLowerCase();
    if (!wanted) break;
    let found = -1;
    for (let imp = 1; imp < 39; imp++) {
      if (improvementName(imp)?.toLowerCase() === wanted) {
        found = imp;
        break;
      }
    }
    if (found < 0) break;
    prefs.autoBuild.push(found);
  }
  return prefs;
}
