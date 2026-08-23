import { peakBac, totalStandardDrinks } from '@shared/drinks.js';
import { recordFor } from '@shared/games.js';
import type { Drink, Match, Member } from '@shared/types.js';
import { formatBac, formatClock, formatDuration, formatStandardDrinks } from '../lib/format.js';

interface NightRecapProps {
  members: Member[];
  drinks: Drink[];
  matches: Match[];
  meId: string;
  now: number;
  onClose: () => void;
}

/**
 * A backward-looking summary, unlike the live BAC chart's rolling 3-hour
 * window — peak BAC here deliberately spans the whole night (first drink to
 * now), since "how high did it get" is exactly what a recap is for.
 */
export function NightRecap({ members, drinks, matches, meId, now, onClose }: NightRecapProps) {
  const firstDrinkAt = drinks.length > 0 ? Math.min(...drinks.map((d) => d.consumedAt)) : null;

  const rows = members
    .map((member) => {
      const theirs = drinks.filter((drink) => drink.memberId === member.id);
      const peak =
        member.weightKg != null
          ? peakBac(theirs, { weightKg: member.weightKg, sex: member.sex }, firstDrinkAt ?? now, now)
          : null;
      return {
        member,
        count: theirs.length,
        standard: totalStandardDrinks(theirs),
        peak,
        record: recordFor(matches, member.id),
      };
    })
    .sort((a, b) => b.standard - a.standard || a.member.name.localeCompare(b.member.name));

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Tonight's recap"
    >
      <div className="sheet stack" onClick={(event) => event.stopPropagation()}>
        <div className="row between">
          <strong>Tonight's recap</strong>
          <button className="btn btn-ghost" style={{ minHeight: 36 }} onClick={onClose}>
            Close
          </button>
        </div>

        {firstDrinkAt == null ? (
          <p className="tiny muted" style={{ margin: 0 }}>
            Nothing to recap yet.
          </p>
        ) : (
          <>
            <p className="tiny muted" style={{ margin: 0 }}>
              {formatClock(firstDrinkAt)} – {formatClock(now)} ({formatDuration(now - firstDrinkAt)})
            </p>

            <div>
              {rows.map((row) => (
                <div className="member-row" key={row.member.id}>
                  <span
                    className="swatch"
                    style={{ background: row.member.color }}
                    aria-hidden="true"
                  />
                  <div>
                    <div className="member-name">
                      {row.member.name}
                      {row.member.id === meId && <span className="muted"> (you)</span>}
                    </div>
                    <div className="member-meta">
                      {row.count} drink{row.count === 1 ? '' : 's'} (
                      {formatStandardDrinks(row.standard)} standard) ·{' '}
                      {row.record.wins > 0 || row.record.losses > 0
                        ? `${row.record.wins}-${row.record.losses} games`
                        : 'no games'}
                    </div>
                  </div>
                  <div className="member-stats">
                    <div className="member-count">
                      {row.peak == null ? '—' : formatBac(row.peak)}
                    </div>
                    <div className="member-meta">
                      {row.peak != null
                        ? 'peak BAC'
                        : row.member.shareBac
                          ? 'no est.'
                          : 'private'}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <p className="tiny disclaimer">
              Peak BAC is a rough estimate from weight and each person's own log — never a measure
              of impairment or of who can drive.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
