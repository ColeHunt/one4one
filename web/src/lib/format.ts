import type { BacBand } from '@shared/drinks.js';

export function formatStandardDrinks(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '');
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
