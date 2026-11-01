import { describe, expect, it } from 'vitest';
import { parseCityPreferences } from '../src/cityPrefs.js';

const names = ['', 'Palace', 'Barracks', 'Granary'];

describe('CITYPREF.TXT', () => {
  it('reads the list up to the first unknown name and notices NODEFEND', () => {
    const p = parseCityPreferences(
      '@NODEFEND\n\n@AUTOBUILD\ngranary, note\nBARRACKS\nNo such thing\nPalace\n',
      (i) => names[i],
    );
    expect(p).toEqual({ noDefend: true, autoBuild: [3, 2] });
  });

  it('asks for nothing when the sections are missing', () => {
    expect(parseCityPreferences('hello', (i) => names[i])).toEqual({
      noDefend: false,
      autoBuild: [],
    });
  });
});
