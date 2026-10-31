/**
 * Parser for LABELS.TXT, the game's indexed string table.
 *
 * Specification: docs/formats/textdata.md, "Family 2". `@STRINGHEAP` holds the heap size,
 * `@POPUPS` the four standard button captions, and `@LABELS` a declared count followed by the
 * strings, addressed by position. The executable's label accessor walks the heap by index
 * (docs/engine/exe-notes.md), which is why order is identity here too.
 */
import { splitSections } from './text.js';

export interface Labels {
  stringHeapSize: number;
  /** OK, Help, Cancel, Custom. */
  buttons: string[];
  /** Declared count on the first line of `@LABELS`. */
  declaredCount: number;
  /** The strings, index = position. */
  labels: string[];
  warnings: string[];
}

function dataLines(lines: string[]): string[] {
  return lines.map((l) => l.trimEnd()).filter((l) => l !== '' && !l.startsWith(';'));
}

export function parseLabels(text: string): Labels {
  const sections = new Map(splitSections(text).map((s) => [s.name, s]));
  const warnings: string[] = [];
  const heap = sections.get('STRINGHEAP');
  const popups = sections.get('POPUPS');
  const labelsSection = sections.get('LABELS');
  if (!heap || !popups || !labelsSection) {
    throw new Error('LABELS.TXT: expected @STRINGHEAP, @POPUPS and @LABELS sections');
  }
  const heapLine = dataLines(heap.lines)[0] ?? '';
  const stringHeapSize = Number.parseInt(heapLine, 10);
  if (Number.isNaN(stringHeapSize)) throw new Error('LABELS.TXT: @STRINGHEAP needs a number');
  const buttons = dataLines(popups.lines);
  const body = dataLines(labelsSection.lines);
  const declaredCount = Number.parseInt(body[0] ?? '', 10);
  if (Number.isNaN(declaredCount)) throw new Error('LABELS.TXT: @LABELS must start with a count');
  const labels = body.slice(1);
  if (labels.length !== declaredCount) {
    warnings.push(`@LABELS declares ${declaredCount} strings but ${labels.length} follow`);
  }
  return { stringHeapSize, buttons, declaredCount, labels, warnings };
}
