import { bacBand, estimateBac, hoursUntilSober, pace, totalStandardDrinks } from '@shared/drinks.js';
import type { Drink, Member } from '@shared/types.js';
import { BAND_LABEL, formatBac, formatDuration, formatStandardDrinks } from '../lib/format.js';

interface MeCardProps {
  me: Member | null;
  myDrinks: Drink[];
  now: number;
  onOpenProfile: () => void;
  onUndo: () => void;
}

export function MeCard({ me, myDrinks, now, onOpenProfile, onUndo }: MeCardProps) {
  const standard = totalStandardDrinks(myDrinks);
  const bac = me ? estimateBac(myDrinks, { weightKg: me.weightKg, sex: me.sex }, now) : null;
  const band = bacBand(bac);
  const perHour = pace(myDrinks, now, 60);

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: '0.75rem' }}>
        <h2 style={{ margin: 0 }}>You</h2>
        <button className="btn btn-ghost" style={{ minHeight: 36, padding: '0.35rem 0.7rem' }} onClick={onOpenProfile}>
          Settings
        </button>
      </div>

      <div className="metrics">
        <div>
          <div className="metric-value">{myDrinks.length}</div>
          <div className="metric-label">Drinks</div>
        </div>
        <div>
          <div className="metric-value">{formatStandardDrinks(standard)}</div>
          <div className="metric-label">Standard</div>
        </div>
        <div>
          <div className="metric-value">{bac == null ? '—' : formatBac(bac)}</div>
          <div className="metric-label">Est. BAC</div>
        </div>
      </div>

      <div className="row between" style={{ marginTop: '0.8rem' }}>
        {/* Without a weight there is no estimate to band, and calling that
            "nothing yet" would misread three drinks as none. */}
        <span className={`band band-${bac == null ? 'none' : band}`}>
          {bac == null ? 'No estimate' : BAND_LABEL[band]}
        </span>
        <span className="tiny muted">{perHour.toFixed(1)} / hr in the last hour</span>
      </div>

      {bac == null ? (
        <p className="tiny disclaimer">
          Add your weight in settings to see a rough BAC estimate. Counts work fine without it.
        </p>
      ) : (
        <p className="tiny disclaimer">
          Rough estimate from weight, time and standard drinks. It ignores food, tolerance,
          medication and individual differences, and it is <strong>not</strong> a measure of
          impairment or of whether you can legally or safely drive. Only time lowers it —
          roughly {formatDuration(hoursUntilSober(bac) * 3_600_000)} to reach zero at this estimate.
        </p>
      )}

      {(band === 'high' || band === 'very_high') && (
        <p className="tiny nudge">
          That's a lot in a short time. Have some water, and line up a ride home rather than
          driving.
        </p>
      )}

      <button
        className="btn btn-ghost btn-full btn-danger"
        style={{ marginTop: '0.75rem' }}
        onClick={onUndo}
        disabled={myDrinks.length === 0}
      >
        Undo last drink
      </button>
    </div>
  );
}
