import { useState } from 'react';
import type { Member, ProfilePatch, Sex } from '@shared/types.js';

interface ProfileSheetProps {
  me: Member;
  onSave: (patch: ProfilePatch) => void;
  onClose: () => void;
}

const KG_PER_LB = 0.453592;

export function ProfileSheet({ me, onSave, onClose }: ProfileSheetProps) {
  const [name, setName] = useState(me.name);
  const [unit, setUnit] = useState<'kg' | 'lb'>('lb');
  const [weight, setWeight] = useState(
    me.weightKg == null ? '' : String(Math.round(me.weightKg / KG_PER_LB)),
  );
  const [sex, setSex] = useState<Sex>(me.sex);
  const [shareBac, setShareBac] = useState(me.shareBac);

  function changeUnit(next: 'kg' | 'lb') {
    if (next === unit) return;
    const value = Number(weight);
    if (Number.isFinite(value) && value > 0) {
      setWeight(String(Math.round(next === 'kg' ? value * KG_PER_LB : value / KG_PER_LB)));
    }
    setUnit(next);
  }

  function save() {
    const entered = Number(weight);
    const weightKg =
      Number.isFinite(entered) && entered > 0
        ? unit === 'kg'
          ? entered
          : entered * KG_PER_LB
        : null;
    onSave({ name: name.trim() || 'Someone', weightKg, sex, shareBac });
    onClose();
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Your settings"
    >
      <div className="sheet stack" onClick={(event) => event.stopPropagation()}>
        <div className="row between">
          <strong>Your settings</strong>
          <button className="btn btn-ghost" style={{ minHeight: 36 }} onClick={onClose}>
            Close
          </button>
        </div>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={24} />
        </label>

        <div className="field">
          <span>Body weight (only used for the BAC estimate)</span>
          <div className="row">
            <input
              type="number"
              inputMode="numeric"
              min="1"
              value={weight}
              onChange={(event) => setWeight(event.target.value)}
              placeholder="Optional"
            />
            <div className="segmented" style={{ flex: 'none' }}>
              <button aria-pressed={unit === 'lb'} onClick={() => changeUnit('lb')}>
                lb
              </button>
              <button aria-pressed={unit === 'kg'} onClick={() => changeUnit('kg')}>
                kg
              </button>
            </div>
          </div>
        </div>

        <div className="field">
          <span>Body type used by the formula</span>
          <div className="segmented">
            <button aria-pressed={sex === 'male'} onClick={() => setSex('male')}>
              Male
            </button>
            <button aria-pressed={sex === 'female'} onClick={() => setSex('female')}>
              Female
            </button>
            <button aria-pressed={sex === 'unspecified'} onClick={() => setSex('unspecified')}>
              Neither
            </button>
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>
            The Widmark formula uses a body-water ratio that differs on average between male and
            female bodies. "Neither" uses a value in between.
          </p>
        </div>

        <label className="row between" style={{ gap: '1rem' }}>
          <span>
            Share my estimate with the room
            <br />
            <span className="tiny muted">
              Off means others still see your counts, but not your BAC estimate — and your weight
              is never sent to their devices.
            </span>
          </span>
          <input
            type="checkbox"
            checked={shareBac}
            onChange={(event) => setShareBac(event.target.checked)}
            style={{ width: 'auto', flex: 'none' }}
          />
        </label>

        <button className="btn btn-primary btn-full" onClick={save}>
          Save
        </button>
      </div>
    </div>
  );
}
