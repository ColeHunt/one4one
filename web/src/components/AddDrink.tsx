import { useState } from 'react';
import { CUSTOM_DRINK_KEY, DRINK_TYPES, ML_PER_OZ, standardDrinks } from '@shared/drinks.js';
import type { NewDrink } from '@shared/types.js';
import { formatStandardDrinks } from '../lib/format.js';

interface AddDrinkProps {
  onAdd: (drink: NewDrink) => void;
}

const BACKDATE_OPTIONS = [
  { label: 'Just now', minutes: 0 },
  { label: '15 min ago', minutes: 15 },
  { label: '30 min ago', minutes: 30 },
  { label: '1 hr ago', minutes: 60 },
];

export function AddDrink({ onAdd }: AddDrinkProps) {
  const [minutesAgo, setMinutesAgo] = useState(0);
  const [showCustom, setShowCustom] = useState(false);
  const [ounces, setOunces] = useState('12');
  const [abvPercent, setAbvPercent] = useState('5');

  const consumedAt = () => Date.now() - minutesAgo * 60_000;

  const customVolumeMl = Number(ounces) * ML_PER_OZ;
  const customAbv = Number(abvPercent) / 100;
  const customStandard = standardDrinks(customVolumeMl, customAbv);

  function addPreset(kind: string) {
    onAdd({ kind, consumedAt: consumedAt() });
    setMinutesAgo(0);
  }

  function addCustom() {
    if (customStandard <= 0) return;
    onAdd({
      kind: CUSTOM_DRINK_KEY,
      volumeMl: customVolumeMl,
      abv: customAbv,
      consumedAt: consumedAt(),
    });
    setMinutesAgo(0);
    setShowCustom(false);
  }

  return (
    <div className="card">
      <h2>Log a drink</h2>

      <div className="drink-grid">
        {DRINK_TYPES.map((type) => (
          <button key={type.key} className="drink-btn" onClick={() => addPreset(type.key)}>
            <span className="emoji" aria-hidden="true">
              {type.emoji}
            </span>
            <span className="label">{type.label}</span>
            <span className="sd">
              {formatStandardDrinks(standardDrinks(type.volumeMl, type.abv))} std
            </span>
          </button>
        ))}
        <button
          className="drink-btn drink-btn-custom"
          aria-expanded={showCustom}
          onClick={() => setShowCustom((open) => !open)}
        >
          <span className="emoji" aria-hidden="true">
            ➕
          </span>
          <span className="label">Custom</span>
          <span className="sd">size &amp; ABV</span>
        </button>
      </div>

      {showCustom && (
        <div className="stack" style={{ marginTop: '0.75rem' }}>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>Ounces</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.5"
                step="0.5"
                value={ounces}
                onChange={(event) => setOunces(event.target.value)}
              />
            </label>
            <label className="field" style={{ flex: 1 }}>
              <span>ABV %</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.1"
                step="0.1"
                value={abvPercent}
                onChange={(event) => setAbvPercent(event.target.value)}
              />
            </label>
          </div>
          <button className="btn btn-primary btn-full" onClick={addCustom} disabled={customStandard <= 0}>
            Add {customStandard > 0 ? `${formatStandardDrinks(customStandard)} std drinks` : 'drink'}
          </button>
        </div>
      )}

      <div className="segmented" style={{ marginTop: '0.75rem' }}>
        {BACKDATE_OPTIONS.map((option) => (
          <button
            key={option.minutes}
            aria-pressed={minutesAgo === option.minutes}
            onClick={() => setMinutesAgo(option.minutes)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="tiny muted" style={{ margin: '0.4rem 0 0' }}>
        Logging a drink you had earlier keeps the estimate honest.
      </p>
    </div>
  );
}
