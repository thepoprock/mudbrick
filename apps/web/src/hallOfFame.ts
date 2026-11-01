/**
 * The Hall of Fame (VERIFIED 0x00429a84, 0x00429b2e and 0x00429bb6): the six best scores kept
 * across games, highest first; a score must beat a kept one to get in. The original writes
 * HALLFAME.DAT beside the game; a browser keeps it in local storage.
 */
export interface FameEntry {
  name: string;
  tribe: string;
  score: number;
  difficulty: number;
  turn: number;
  year: string;
  cheated: boolean;
}

const KEY = 'mudbrick-hall-of-fame';
const KEEP = 6;
const LEVELS = ['Chieftain', 'Warlord', 'Prince', 'King', 'Emperor', 'Deity'];

export function readFame(): FameEntry[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? (list as FameEntry[]) : [];
  } catch {
    return [];
  }
}

/** Put a score in its place and return the list. */
export function placeFameEntry(list: FameEntry[], entry: FameEntry): FameEntry[] {
  const at = list.findIndex((e) => e.score < entry.score);
  if (at < 0) return list.length < KEEP ? [...list, entry] : list;
  return [...list.slice(0, at), entry, ...list.slice(at)].slice(0, KEEP);
}

export function addFameEntry(entry: FameEntry): FameEntry[] {
  const list = placeFameEntry(readFame(), entry);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // A browser without storage keeps no Hall of Fame.
  }
  return list;
}

export function fameLines(list: FameEntry[]): string[] {
  if (list.length === 0) return ['The Hall of Fame is empty.'];
  return [
    'Hall of Fame',
    ...list.map(
      (e, i) =>
        `${i + 1}. ${e.name} of the ${e.tribe}: ${e.score}, ${LEVELS[e.difficulty] ?? '?'}, ${e.year}${e.cheated ? ', cheated' : ''}`,
    ),
  ];
}
