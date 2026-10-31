import { describe, expect, it } from 'vitest';
import { fields, num, splitSections, stripComment } from '../src/text.js';

describe('splitSections', () => {
  it('starts sections at upper-case @NAME lines only', () => {
    const s = splitSections('; header\r\n@ONE\r\na\r\n@width=200\r\n@TWO_2\r\nb\r\n');
    expect(s.map((x) => x.name)).toEqual(['ONE', 'TWO_2']);
    expect(s[0]?.lines).toEqual(['a', '@width=200']);
    expect(s[1]?.startLine).toBe(5);
  });

  it('ignores @@ sub-entries', () => {
    expect(splitSections('@A\n@@INDEX\n1,\n').map((x) => x.lines)).toEqual([['@@INDEX', '1,']]);
  });
});

describe('field helpers', () => {
  it('strips comments and splits fields', () => {
    expect(stripComment('a, b ; note')).toEqual({ body: 'a, b ', comment: 'note' });
    expect(fields(' Settlers, Exp , 0 ')).toEqual(['Settlers', 'Exp', '0']);
  });

  it('parses decorated numbers', () => {
    expect([num('1.'), num('0a'), num('1d'), num('2h'), num('-2'), num(' 10 ')]).toEqual([
      1, 0, 1, 2, -2, 10,
    ]);
    expect(() => num('nil')).toThrow();
  });
});
