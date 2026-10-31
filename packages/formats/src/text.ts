/**
 * Shared helpers for the original game's text data files.
 *
 * All of them are Windows-1252 encoded with CRLF line endings. A line that begins with `@NAME`
 * (upper-case) opens a section that runs until the next such line. Lower-case `@directives`
 * such as `@width=200` belong to the section body and are NOT section headers.
 * `;` starts a comment in the rules file; other files use `;` only for leading comment blocks.
 *
 * Specification: docs/formats/textdata.md
 */

export interface Section {
  /** Section name without the leading `@`. */
  name: string;
  /** Raw body lines (CR stripped, comments NOT stripped). */
  lines: string[];
  /** 1-based line number of the `@NAME` header in the source file. */
  startLine: number;
}

const SECTION_HEADER = /^@([A-Z][A-Z0-9_]*)\s*$/;
/** `@end` closes the current section early (used in CITY.TXT and DEBUG.TXT). */
const SECTION_END = /^@end\s*$/i;

/**
 * Windows-1252 differs from ISO-8859-1 only in 0x80–0x9F. Five of those slots (0x81, 0x8D,
 * 0x8F, 0x90, 0x9D) are undefined and decode to U+FFFD. Implemented here so the package needs
 * neither the DOM nor Node's TextDecoder.
 */
const CP1252_HIGH = [
  0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039,
  0x0152, 0xfffd, 0x017d, 0xfffd, 0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178,
];

/** Decode a Windows-1252 byte buffer to a string. */
export function decodeText(bytes: Uint8Array): string {
  const out = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] ?? 0;
    const code = b >= 0x80 && b <= 0x9f ? (CP1252_HIGH[b - 0x80] ?? 0xfffd) : b;
    out[i] = String.fromCharCode(code);
  }
  return out.join('');
}

/** Encode a string as Windows-1252; characters outside the code page become `?`. */
export function encodeText(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) out[i] = code;
    else {
      const hi = CP1252_HIGH.indexOf(code);
      out[i] = hi >= 0 && code !== 0xfffd ? 0x80 + hi : 0x3f;
    }
  }
  return out;
}

/** Split text into lines, tolerating CRLF, LF and a missing final newline. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Split a text file into `@NAME` sections. Text before the first header is discarded. */
export function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let current: Section | undefined;
  splitLines(text).forEach((line, i) => {
    const m = SECTION_HEADER.exec(line);
    if (m?.[1] !== undefined) {
      current = { name: m[1], lines: [], startLine: i + 1 };
      sections.push(current);
    } else if (SECTION_END.test(line)) {
      current = undefined;
    } else if (current) {
      current.lines.push(line);
    }
  });
  return sections;
}

/** Split a line into `body` (before the first `;`) and `comment` (after it, trimmed). */
export function stripComment(line: string): { body: string; comment: string } {
  const i = line.indexOf(';');
  if (i < 0) return { body: line, comment: '' };
  return { body: line.slice(0, i), comment: line.slice(i + 1).trim() };
}

/** Comma-separated fields, trimmed. */
export function fields(body: string): string[] {
  return body.split(',').map((f) => f.trim());
}

/**
 * Parse an integer field that may carry the rules file's unit-letter decorations:
 * `1.` (movement), `0a` / `1d` (attack / defence), `2h` (hit points), `1f` (firepower).
 * Throws on anything that does not start with an integer.
 */
export function num(field: string): number {
  const m = /^(-?\d+)/.exec(field.trim());
  if (!m?.[1]) throw new Error(`expected a number, got "${field}"`);
  return Number.parseInt(m[1], 10);
}
