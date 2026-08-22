import { bacBand, estimateBac, pace, totalStandardDrinks } from '@shared/drinks.js';
import type { Drink, Member } from '@shared/types.js';
import { BAND_LABEL, formatBac, formatStandardDrinks } from '../lib/format.js';

interface LeaderboardProps {
  members: Member[];
  drinks: Drink[];
  meId: string;
  now: number;
  onSelectMember: (memberId: string) => void;
}

export function Leaderboard({ members, drinks, meId, now, onSelectMember }: LeaderboardProps) {
  const rows = members
    .map((member) => {
      const theirs = drinks.filter((drink) => drink.memberId === member.id);
      // Members who opted out have their weight redacted server-side, so this
      // is null for them and no estimate can be shown.
      const bac = member.shareBac
        ? estimateBac(theirs, { weightKg: member.weightKg, sex: member.sex }, now)
        : null;
      return {
        member,
        count: theirs.length,
        standard: totalStandardDrinks(theirs),
        perHour: pace(theirs, now, 60),
        bac,
      };
    })
    .sort((a, b) => b.standard - a.standard || a.member.name.localeCompare(b.member.name));

  return (
    <div className="card">
      <h2>The room</h2>
      {rows.map((row) => (
        <button
          className="member-row"
          key={row.member.id}
          onClick={() => onSelectMember(row.member.id)}
          aria-label={`View ${row.member.name}'s drinks`}
        >
          <span className="swatch" style={{ background: row.member.color }} aria-hidden="true" />
          <div>
            <div className="member-name">
              {row.member.name}
              {row.member.id === meId && <span className="muted"> (you)</span>}
            </div>
            <div className="member-meta">
              {row.count} drink{row.count === 1 ? '' : 's'} · {row.perHour.toFixed(1)}/hr
              {row.bac != null && ` · ${BAND_LABEL[bacBand(row.bac)].toLowerCase()}`}
            </div>
          </div>
          <div className="member-stats">
            <div className="member-count">{formatStandardDrinks(row.standard)}</div>
            <div className="member-meta">
              {row.bac == null ? (row.member.shareBac ? 'no est.' : 'private') : formatBac(row.bac)}
            </div>
          </div>
        </button>
      ))}
      <p className="tiny disclaimer">
        "Standard" counts 14 g of alcohol, so a shot and a pint compare fairly. Estimates are rough
        and are never a judgement about who can drive.
      </p>
    </div>
  );
}
