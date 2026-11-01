import { describe, expect, it } from 'vitest';
import { councilSpeech, parseCouncil } from '../src/council.js';
import { Rng } from '../src/rng.js';

const text = `
@M1
0,98, Military: Build more units!
t, 3560,3598, Trade: I disagree.
s1, 3353,3386, Science: Yes.
s, 3353,3386, Science: No.
end

@A5
5821,5867, Attitude: No complaints, noble leader.
f7, 3815,3843, Foreign: I agree.
#, end
s7, 1,2, Science: Never reached.
end
`;

describe('the High Council', () => {
  it('the rated advisor speaks, then others by their codes, each once', () => {
    const s = parseCouncil(text);
    const said = councilSpeech(s, 0, [1, 1, 1, 1, 1], new Rng(1));
    expect(said).toEqual(['Military: Build more units!', 'Trade: I disagree.', 'Science: Yes.']);
  });
  it('a coded level must match, and # stops after a line that answered', () => {
    const s = parseCouncil(text);
    expect(councilSpeech(s, 4, [1, 7, 1, 7, 5], new Rng(1))).toEqual([
      'Attitude: No complaints, noble leader.',
      'Foreign: I agree.',
    ]);
    expect(councilSpeech(s, 4, [1, 7, 1, 1, 5], new Rng(1))).toEqual([
      'Attitude: No complaints, noble leader.',
      'Science: Never reached.',
    ]);
  });
});
