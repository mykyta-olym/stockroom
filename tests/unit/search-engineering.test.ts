import { describe, expect, it } from 'vitest';
import { compareSpecValues, parseEngineeringValue } from '@/domain/engineering';
import { buildSearchText, tokenizeQuery, toPrefixTsQuery } from '@/domain/search';

describe('parseEngineeringValue', () => {
  it.each([
    ['10 Ohm', 10],
    ['4.7 kOhm', 4700],
    ['1 MOhm', 1_000_000],
    ['100 nF', 100e-9],
    ['10 pF', 10e-12],
    ['4.7 uF', 4.7e-6],
    ['22 uH', 22e-6],
    ['48 MHz', 48e6],
    ['0.1 W', 0.1],
    ['25 V', 25],
    ['300 mA', 0.3],
    ['256 KB', 256_000],
    ['5%', 5],
    ['2.7 to 5.5 V', 2.7],
    ['-40 to 85 C', -40],
    ['16', 16],
  ])('reads %s', (input, expected) => {
    expect(parseEngineeringValue(input)).toBeCloseTo(expected, 15);
  });

  it.each(['X7R', 'Red', 'I2C', ''])('returns null for %j', (input) => {
    expect(parseEngineeringValue(input)).toBeNull();
  });

  it('does not read a plain unit as a prefix', () => {
    expect(parseEngineeringValue('5 m')).toBe(5);
    expect(parseEngineeringValue('3 A')).toBe(3);
  });
});

describe('compareSpecValues', () => {
  const entry = (value: string) => ({ value, sortValue: parseEngineeringValue(value) });

  it('sorts by magnitude', () => {
    const sorted = ['1 MOhm', '10 Ohm', '4.7 kOhm', '100 Ohm']
      .map(entry)
      .sort(compareSpecValues)
      .map((item) => item.value);
    expect(sorted).toEqual(['10 Ohm', '100 Ohm', '4.7 kOhm', '1 MOhm']);
  });

  it('puts numbers before words and sorts words alphabetically', () => {
    const sorted = ['Red', '5 V', 'Amber']
      .map(entry)
      .sort(compareSpecValues)
      .map((item) => item.value);
    expect(sorted).toEqual(['5 V', 'Amber', 'Red']);
  });

  it('falls back to the text when magnitudes are equal', () => {
    const sorted = ['1000 mV', '1 V']
      .map(entry)
      .sort(compareSpecValues)
      .map((item) => item.value);
    expect(sorted).toEqual(['1 V', '1000 mV']);
  });
});

describe('tokenizeQuery', () => {
  it('lower-cases and splits on spaces', () => {
    expect(tokenizeQuery('  10K   0603 ')).toEqual(['10k', '0603']);
  });

  it('keeps characters that occur in part numbers', () => {
    expect(tokenizeQuery('SOT-23 4.7k 1% A_B')).toEqual(['sot-23', '4.7k', '1%', 'a_b']);
  });

  it('removes characters with a meaning in tsquery', () => {
    expect(tokenizeQuery("a'b c&d (e) f:* g|h !i <j> \\k")).toEqual([
      'ab',
      'cd',
      'e',
      'f',
      'gh',
      'i',
      'j',
      'k',
    ]);
  });

  it('drops tokens with no letter or digit', () => {
    expect(tokenizeQuery('+ . - % 5')).toEqual(['5']);
    expect(tokenizeQuery('+ . -')).toEqual([]);
  });

  it('limits length and token count', () => {
    expect(tokenizeQuery('a b c d e f g h i j k')).toHaveLength(8);
    expect(tokenizeQuery('x'.repeat(5000))[0]).toHaveLength(100);
  });

  it('handles an empty query', () => {
    expect(tokenizeQuery('')).toEqual([]);
  });
});

describe('toPrefixTsQuery', () => {
  it('requires every token, each as a prefix', () => {
    expect(toPrefixTsQuery(['10k', '0603'])).toBe("'10k':* & '0603':*");
  });
});

describe('buildSearchText', () => {
  const text = buildSearchText({
    sku: 'SR-100001',
    mpn: 'ORP-RC0603-10K0-F',
    name: 'Thick film resistor',
    description: 'A resistor.',
    package: 'SOT-23',
    manufacturer: 'Orrin Passives',
    category: 'Resistors',
    specs: [{ name: 'Resistance', value: '10 kOhm' }],
  });

  it('contains the identifying fields', () => {
    for (const part of ['SR-100001', 'ORP-RC0603-10K0-F', 'Orrin Passives', 'Resistors']) {
      expect(text).toContain(part);
    }
  });

  it('adds compact forms next to the originals', () => {
    expect(text).toContain('10 kOhm');
    expect(text).toContain('10kohm');
    expect(text).toContain('sot23');
    expect(text).toContain('orprc060310k0f');
  });
});
