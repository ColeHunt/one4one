import type { Drink, Sex } from './types.js';

/** Grams of ethanol in one US standard drink. */
export const GRAMS_PER_STANDARD_DRINK = 14;

/** Density of ethanol in g/mL. */
export const ETHANOL_DENSITY = 0.789;

/** Widmark elimination rate, in BAC percentage points per hour. */
export const ELIMINATION_RATE_PER_HOUR = 0.015;

export const ML_PER_OZ = 29.5735;

export interface DrinkType {
  key: string;
  label: string;
  emoji: string;
  volumeMl: number;
  /** Alcohol by volume as a fraction, e.g. 0.05 for 5%. */
  abv: number;
}

/**
 * Preset drinks. Standard-drink values are derived from volume and ABV with the
 * same formula as custom entries, so nothing is hardcoded twice.
 *
 * A preset's `key`, `volumeMl` and `abv` are effectively frozen once anyone has
 * logged a drink. Standard drinks are computed at insert time and stored, so
 * changing a measurement makes one button mean two different numbers within a
 * single night's log; changing a key orphans stored drinks from `getDrinkType`,
 * and their log rows fall back to "Custom". Labels are free to change.
 */
export const DRINK_TYPES: DrinkType[] = [
  { key: 'beer', label: 'Beer', emoji: '🍺', volumeMl: 355, abv: 0.05 },
  { key: 'light_beer', label: 'Light beer', emoji: '🍻', volumeMl: 355, abv: 0.042 },
  { key: 'ipa', label: 'IPA / tall can', emoji: '🍺', volumeMl: 473, abv: 0.065 },
  { key: 'wine', label: 'Wine', emoji: '🍷', volumeMl: 148, abv: 0.12 },
  { key: 'shot', label: 'Shot', emoji: '🥃', volumeMl: 44, abv: 0.4 },
  // A well highball is one pour plus a mixer, and the mixer contributes no
  // alcohol — so it measures exactly as a shot does, under its own label.
  { key: 'well', label: 'Well drink', emoji: '🍹', volumeMl: 44, abv: 0.4 },
  { key: 'cocktail', label: 'Craft cocktail', emoji: '🍸', volumeMl: 66, abv: 0.4 },
  { key: 'seltzer', label: 'Seltzer', emoji: '🥤', volumeMl: 355, abv: 0.05 },
];

export const CUSTOM_DRINK_KEY = 'custom';

const DRINK_TYPES_BY_KEY = new Map(DRINK_TYPES.map((t) => [t.key, t]));

export function getDrinkType(key: string): DrinkType | undefined {
  return DRINK_TYPES_BY_KEY.get(key);
}

/** US standard drinks contained in `volumeMl` of liquid at `abv` (fraction). */
export function standardDrinks(volumeMl: number, abv: number): number {
  if (!Number.isFinite(volumeMl) || !Number.isFinite(abv)) return 0;
  if (volumeMl <= 0 || abv <= 0) return 0;
  return (volumeMl * abv * ETHANOL_DENSITY) / GRAMS_PER_STANDARD_DRINK;
}

/**
 * Resolve a drink kind (plus optional custom volume/ABV) to standard drinks.
 * Returns null when the input does not describe a drink we can measure.
 */
export function resolveStandardDrinks(
  kind: string,
  volumeMl?: number | null,
  abv?: number | null,
): number | null {
  const preset = getDrinkType(kind);
  if (preset) return standardDrinks(preset.volumeMl, preset.abv);
  if (kind !== CUSTOM_DRINK_KEY) return null;
  if (volumeMl == null || abv == null) return null;
  const sd = standardDrinks(volumeMl, abv);
  return sd > 0 ? sd : null;
}

/** Widmark distribution ratio by sex. */
export function widmarkR(sex: Sex): number {
  switch (sex) {
    case 'male':
      return 0.68;
    case 'female':
      return 0.55;
    default:
      return 0.615;
  }
}

export interface BacProfile {
  weightKg: number | null;
  sex: Sex;
}

/**
 * Rough Widmark BAC estimate as a percentage (e.g. 0.06 means 0.06% BAC).
 *
 * Each drink contributes independently and is eliminated at a fixed rate from
 * its own timestamp, clamped at zero, then summed. This is a coarse model: it
 * ignores absorption time, food, tolerance, medication and individual
 * variation. It is never a measure of impairment or fitness to drive.
 *
 * Returns null when we lack a body weight, rather than guessing one.
 */
export function estimateBac(drinks: Drink[], profile: BacProfile, now: number): number | null {
  const { weightKg } = profile;
  if (weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) return null;

  const bodyWaterGrams = weightKg * 1000 * widmarkR(profile.sex);
  let bac = 0;

  for (const drink of drinks) {
    const hoursElapsed = (now - drink.consumedAt) / 3_600_000;
    if (hoursElapsed < 0) continue;
    const grams = drink.standardDrinks * GRAMS_PER_STANDARD_DRINK;
    const peak = (grams / bodyWaterGrams) * 100;
    const remaining = peak - ELIMINATION_RATE_PER_HOUR * hoursElapsed;
    if (remaining > 0) bac += remaining;
  }

  return bac;
}

/** Hours until an estimate reaches zero at the fixed elimination rate. */
export function hoursUntilSober(bac: number): number {
  if (bac <= 0) return 0;
  return bac / ELIMINATION_RATE_PER_HOUR;
}

/** Standard drinks consumed within the last `windowMinutes`, per hour. */
export function pace(drinks: Drink[], now: number, windowMinutes = 60): number {
  const cutoff = now - windowMinutes * 60_000;
  let total = 0;
  for (const drink of drinks) {
    if (drink.consumedAt >= cutoff && drink.consumedAt <= now) total += drink.standardDrinks;
  }
  return total / (windowMinutes / 60);
}

export function totalStandardDrinks(drinks: Drink[]): number {
  let total = 0;
  for (const drink of drinks) total += drink.standardDrinks;
  return total;
}

export type BacBand = 'none' | 'low' | 'moderate' | 'high' | 'very_high';

/**
 * Coarse descriptive band for an estimate. Deliberately descriptive rather than
 * prescriptive: no band ever implies it is fine to drive.
 */
export function bacBand(bac: number | null): BacBand {
  if (bac == null || bac <= 0.001) return 'none';
  if (bac < 0.04) return 'low';
  if (bac < 0.08) return 'moderate';
  if (bac < 0.15) return 'high';
  return 'very_high';
}
