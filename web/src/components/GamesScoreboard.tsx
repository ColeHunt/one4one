import { recordFor } from '@shared/games.js';
import type { Match, Member } from '@shared/types.js';

interface GamesScoreboardProps {
  members: Member[];
  matches: Match[];
  meId: string;
  onSelectMember: (memberId: string) => void;
  onReportGame?: () => void;
  /** A spectator can browse the scoreboard but has no result to report. */
  readOnly?: boolean;
}

export function GamesScoreboard({
  members,
  matches,
  meId,
  onSelectMember,
  onReportGame,
  readOnly = false,
}: GamesScoreboardProps) {
  const rows = members
    .map((member) => ({ member, record: recordFor(matches, member.id) }))
    .filter((row) => row.record.wins > 0 || row.record.losses > 0)
    .sort(
      (a, b) =>
        b.record.wins - a.record.wins ||
        a.record.losses - b.record.losses ||
        a.member.name.localeCompare(b.member.name),
    );

  return (
    <div className="card">
      <div className="row between" style={{ marginBottom: '0.6rem' }}>
        <h2 style={{ margin: 0 }}>Scoreboard</h2>
        {!readOnly && (
          <button
            className="btn btn-ghost tiny"
            style={{ minHeight: 32, padding: '0.2rem 0.6rem' }}
            onClick={onReportGame}
          >
            Report a game
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="tiny muted" style={{ margin: 0 }}>
          No games reported yet.
        </p>
      ) : (
        rows.map((row) => (
          <button
            className="member-row"
            key={row.member.id}
            onClick={() => onSelectMember(row.member.id)}
            aria-label={`View ${row.member.name}'s game history`}
          >
            <span className="swatch" style={{ background: row.member.color }} aria-hidden="true" />
            <div>
              <div className="member-name">
                {row.member.name}
                {row.member.id === meId && <span className="muted"> (you)</span>}
              </div>
              <div className="member-meta">
                {row.record.wins} win{row.record.wins === 1 ? '' : 's'} · {row.record.losses} loss
                {row.record.losses === 1 ? '' : 'es'}
              </div>
            </div>
            <div className="member-stats">
              <div className="member-count">
                {row.record.wins}-{row.record.losses}
              </div>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
