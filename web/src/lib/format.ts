import type { BacBand } from '@shared/drinks.js';
import { ML_PER_OZ } from '@shared/drinks.js';

export function formatStandardDrinks(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
}

/**
 * The pour size and strength a preset assumes, e.g. "12oz, 5% ABV" — shown so
 * someone whose actual drink doesn't match the preset (a bigger pour, a
 * stronger beer) can see the assumption and judge whether to use it or switch
 * to Custom instead.
 */
export function formatOzAbv(volumeMl: number, abv: number): string {
  const oz = (volumeMl / ML_PER_OZ).toFixed(1).replace(/\.0$/, '');
  const abvPercent = (abv * 100).toFixed(1).replace(/\.0$/, '');
  return `${oz}oz, ${abvPercent}% ABV`;
}

export function formatBac(bac: number): string {
  return bac.toFixed(3);
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export const BAND_LABEL: Record<BacBand, string> = {
  none: 'Nothing yet',
  low: 'Low',
  moderate: 'Moderate',
  high: 'High',
  very_high: 'Very high',
};
