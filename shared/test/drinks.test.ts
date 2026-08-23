import { describe, expect, it } from 'vitest';
import {
  DRINK_TYPES,
  ELIMINATION_RATE_PER_HOUR,
  bacBand,
  bacSampleTimes,
  estimateBac,
  hoursUntilSober,
  pace,
  peakBac,
  resolveStandardDrinks,
  standardDrinks,
  totalStandardDrinks,
  widmarkR,
} from '../src/drinks.js';
import type { Drink } from '../src/types.js';

const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

function drink(overrides: Partial<Drink> = {}): Drink {
  return {
    id: Math.random().toString(36).slice(2),
    memberId: 'm1',
    kind: 'beer',
    standardDrinks: 1,
    volumeMl: null,
    abv: null,
    consumedAt: NOW,
    ...overrides,
  };
}

describe('standardDrinks', () => {
  it('treats a 12oz 5% beer as one standard drink', () => {
    expect(standardDrinks(355, 0.05)).toBeCloseTo(1, 2);
  });

  it('treats a 5oz 12% glass of wine as one standard drink', () => {
    expect(standardDrinks(148, 0.12)).toBeCloseTo(1, 2);
  });

  it('treats a 1.5oz 40% shot as one standard drink', () => {
    expect(standardDrinks(44, 0.4)).toBeCloseTo(1, 1);
  });

  it('scales linearly with volume and ABV', () => {
    expect(standardDrinks(710, 0.05)).toBeCloseTo(2 * standardDrinks(355, 0.05), 6);
    expect(standardDrinks(355, 0.1)).toBeCloseTo(2 * standardDrinks(355, 0.05), 6);
  });

  it('returns 0 for non-positive or non-finite input', () => {
    expect(standardDrinks(0, 0.05)).toBe(0);
    expect(standardDrinks(355, 0)).toBe(0);
    expect(standardDrinks(-355, 0.05)).toBe(0);
    expect(standardDrinks(Number.NaN, 0.05)).toBe(0);
  });
});

describe('preset stability', () => {
  /**
   * Keys are persisted on every logged drink, so renaming one orphans history
   * from getDrinkType and its log rows degrade to "Custom". Changing this list
   * is a deliberate act: update it only alongside a migration for stored rows.
   */
  it('keeps its keys stable', () => {
    expect(DRINK_TYPES.map((type) => type.key)).toEqual([
      'beer',
      'light_beer',
      'ipa',
      'wine',
      'shot',
      'well',
      'cocktail',
      'seltzer',
    ]);
  });

  it('gives every preset a non-empty example, so a button never ships blank', () => {
    for (const type of DRINK_TYPES) {
      expect(type.examples.trim().length, type.key).toBeGreaterThan(0);
    }
  });

  it('measures a well drink as one pour, same as a shot', () => {
    // 44ml is a hair under a true 1.5oz pour, so this lands at 0.992 and
    // displays as "1 std" — the same tolerance the shot preset is held to.
    const well = resolveStandardDrinks('well');
    expect(well).toBeCloseTo(1, 1);
    // The two are the same pour by definition; drift between them is a bug.
    expect(well).toBe(resolveStandardDrinks('shot'));
  });

  it('keeps a craft cocktail measurably bigger than a well drink', () => {
    expect(resolveStandardDrinks('cocktail')!).toBeGreaterThan(resolveStandardDrinks('well')!);
  });
});

describe('resolveStandardDrinks', () => {
  it('resolves every preset to a positive value', () => {
    for (const type of DRINK_TYPES) {
      const sd = resolveStandardDrinks(type.key);
      expect(sd, type.key).not.toBeNull();
      expect(sd!, type.key).toBeGreaterThan(0);
    }
  });

  it('ignores volume and ABV overrides for presets', () => {
    expect(resolveStandardDrinks('beer', 9999, 0.99)).toBeCloseTo(1, 2);
  });

  it('uses volume and ABV for custom drinks', () => {
    expect(resolveStandardDrinks('custom', 355, 0.05)).toBeCloseTo(1, 2);
  });

  it('rejects custom drinks with missing or unusable measurements', () => {
    expect(resolveStandardDrinks('custom')).toBeNull();
    expect(resolveStandardDrinks('custom', 355, null)).toBeNull();
    expect(resolveStandardDrinks('custom', 0, 0.05)).toBeNull();
  });

  it('rejects unknown kinds', () => {
    expect(resolveStandardDrinks('moonshine')).toBeNull();
  });
});

describe('estimateBac', () => {
  it('returns null without a body weight rather than guessing', () => {
    expect(estimateBac([drink()], { weightKg: null, sex: 'male' }, NOW)).toBeNull();
    expect(estimateBac([drink()], { weightKg: 0, sex: 'male' }, NOW)).toBeNull();
  });

  it('matches a hand-computed Widmark value for one drink at t=0', () => {
    // 14 g / (80 kg * 1000 * 0.68) * 100 = 0.02574%
    const bac = estimateBac([drink()], { weightKg: 80, sex: 'male' }, NOW);
    expect(bac).toBeCloseTo(0.0257, 4);
  });

  it('gives a higher estimate at the same dose for a lower r', () => {
    const male = estimateBac([drink()], { weightKg: 70, sex: 'male' }, NOW)!;
    const female = estimateBac([drink()], { weightKg: 70, sex: 'female' }, NOW)!;
    expect(female).toBeGreaterThan(male);
    expect(widmarkR('unspecified')).toBeGreaterThan(widmarkR('female'));
  });

  it('eliminates alcohol over time', () => {
    const profile = { weightKg: 80, sex: 'male' as const };
    const one = drink({ consumedAt: NOW - HOUR });
    const bac = estimateBac([one], profile, NOW)!;
    expect(bac).toBeCloseTo(0.0257 - ELIMINATION_RATE_PER_HOUR, 4);
  });

  it('clamps a fully eliminated drink at zero instead of going negative', () => {
    const profile = { weightKg: 80, sex: 'male' as const };
    const old = drink({ consumedAt: NOW - 24 * HOUR });
    expect(estimateBac([old], profile, NOW)).toBe(0);
  });

  it('does not let an old drink cancel out a fresh one', () => {
    const profile = { weightKg: 80, sex: 'male' as const };
    const fresh = estimateBac([drink()], profile, NOW)!;
    const withOld = estimateBac([drink({ consumedAt: NOW - 24 * HOUR }), drink()], profile, NOW)!;
    expect(withOld).toBeCloseTo(fresh, 6);
  });

  it('sums concurrent drinks', () => {
    const profile = { weightKg: 80, sex: 'male' as const };
    const one = estimateBac([drink()], profile, NOW)!;
    const three = estimateBac([drink(), drink(), drink()], profile, NOW)!;
    expect(three).toBeCloseTo(3 * one, 6);
  });

  it('ignores drinks dated in the future', () => {
    const profile = { weightKg: 80, sex: 'male' as const };
    expect(estimateBac([drink({ consumedAt: NOW + HOUR })], profile, NOW)).toBe(0);
  });

  it('scales inversely with body weight', () => {
    const light = estimateBac([drink()], { weightKg: 50, sex: 'male' }, NOW)!;
    const heavy = estimateBac([drink()], { weightKg: 100, sex: 'male' }, NOW)!;
    expect(light).toBeCloseTo(2 * heavy, 6);
  });

  it('returns 0 for an empty log', () => {
    expect(estimateBac([], { weightKg: 80, sex: 'male' }, NOW)).toBe(0);
  });
});

describe('bacSampleTimes', () => {
  it('always includes the domain bounds', () => {
    const times = bacSampleTimes([], NOW, NOW + 3 * HOUR);
    expect(times[0]).toBe(NOW);
    expect(times[times.length - 1]).toBe(NOW + 3 * HOUR);
  });

  it('is sorted ascending', () => {
    const times = bacSampleTimes([drink({ consumedAt: NOW + HOUR })], NOW, NOW + 2 * HOUR);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('produces roughly sampleCount evenly spaced points with no drinks', () => {
    const times = bacSampleTimes([], NOW, NOW + 6 * HOUR, 60);
    expect(times).toHaveLength(61);
  });

  it("includes a drink's exact instant and the instant before it", () => {
    const at = NOW + HOUR;
    const times = bacSampleTimes([drink({ consumedAt: at })], NOW, NOW + 2 * HOUR);
    expect(times).toContain(at);
    expect(times).toContain(at - 1);
  });

  it('excludes a drink outside the window', () => {
    const times = bacSampleTimes([drink({ consumedAt: NOW - HOUR })], NOW, NOW + HOUR);
    expect(times).not.toContain(NOW - HOUR);
    expect(times).not.toContain(NOW - HOUR - 1);
  });
});

describe('peakBac', () => {
  it('returns null with no weight, same as estimateBac', () => {
    expect(peakBac([drink()], { weightKg: null, sex: 'male' }, NOW - HOUR, NOW + HOUR)).toBeNull();
  });

  it('is 0 for a weighted member with no drinks in range', () => {
    expect(peakBac([], { weightKg: 80, sex: 'male' }, NOW - HOUR, NOW + HOUR)).toBe(0);
  });

  it("matches estimateBac's value at the drink's own instant", () => {
    const profile = { weightKg: 80, sex: 'male' as const };
    const drinks = [drink({ consumedAt: NOW })];
    const expected = estimateBac(drinks, profile, NOW)!;
    expect(peakBac(drinks, profile, NOW - HOUR, NOW + HOUR)).toBeCloseTo(expected, 6);
  });

  it('finds a peak that has since decayed below the value at the end of the window', () => {
    const profile = { weightKg: 80, sex: 'male' as const };
    // One drink an hour before the window ends: peak is at consumption, and by
    // the end of the window it has decayed — the peak must still be reported,
    // not the smaller end-of-window value.
    const drinks = [drink({ consumedAt: NOW })];
    const peak = peakBac(drinks, profile, NOW - HOUR, NOW + HOUR)!;
    const atEnd = estimateBac(drinks, profile, NOW + HOUR)!;
    expect(peak).toBeGreaterThan(atEnd);
    expect(peak).toBeCloseTo(estimateBac(drinks, profile, NOW)!, 6);
  });

  it('finds the higher of two separate peaks', () => {
    const profile = { weightKg: 80, sex: 'male' as const };
    const drinks = [
      drink({ consumedAt: NOW, standardDrinks: 1 }),
      drink({ consumedAt: NOW + HOUR, standardDrinks: 3 }),
    ];
    const peak = peakBac(drinks, profile, NOW - HOUR, NOW + 2 * HOUR)!;
    const secondPeak = estimateBac(drinks, profile, NOW + HOUR)!;
    expect(peak).toBeCloseTo(secondPeak, 6);
    expect(peak).toBeGreaterThan(estimateBac(drinks, profile, NOW)!);
  });
});

describe('hoursUntilSober', () => {
  it('divides the estimate by the elimination rate', () => {
    expect(hoursUntilSober(0.03)).toBeCloseTo(2, 6);
  });

  it('is zero at or below zero', () => {
    expect(hoursUntilSober(0)).toBe(0);
    expect(hoursUntilSober(-0.01)).toBe(0);
  });
});

describe('pace', () => {
  it('counts only drinks inside the window', () => {
    const drinks = [
      drink({ consumedAt: NOW - 10 * 60_000 }),
      drink({ consumedAt: NOW - 30 * 60_000 }),
      drink({ consumedAt: NOW - 3 * HOUR }),
    ];
    expect(pace(drinks, NOW, 60)).toBeCloseTo(2, 6);
  });

  it('normalises a half-hour window to a per-hour rate', () => {
    const drinks = [drink({ consumedAt: NOW - 10 * 60_000 })];
    expect(pace(drinks, NOW, 30)).toBeCloseTo(2, 6);
  });

  it('is zero with no recent drinks', () => {
    expect(pace([drink({ consumedAt: NOW - 5 * HOUR })], NOW, 60)).toBe(0);
  });
});

describe('totalStandardDrinks', () => {
  it('sums fractional standard drinks', () => {
    expect(totalStandardDrinks([drink({ standardDrinks: 0.5 }), drink({ standardDrinks: 1.5 })]))
      .toBeCloseTo(2, 6);
  });
});

describe('bacBand', () => {
  it('bands estimates without implying fitness to drive', () => {
    expect(bacBand(null)).toBe('none');
    expect(bacBand(0)).toBe('none');
    expect(bacBand(0.02)).toBe('low');
    expect(bacBand(0.05)).toBe('moderate');
    expect(bacBand(0.1)).toBe('high');
    expect(bacBand(0.2)).toBe('very_high');
  });
});
