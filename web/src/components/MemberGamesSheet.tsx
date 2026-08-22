import { GAME_TYPES, getGameType, recordFor } from '@shared/games.js';
import type { Match, Member } from '@shared/types.js';
import { formatClock } from '../lib/format.js';

interface MemberGamesSheetProps {
  member: Member;
  /** Already filtered to matches this member played in — same convention as MemberDrinksSheet. */
  matches: Match[];
  /** Full room roster, needed to resolve teammate/opponent names in the history list. */
  members: Member[];
  meId: string;
  onRetract: (matchId: string) => void;
  onClose: () => void;
}

export function MemberGamesSheet({
  member,
  matches,
  members,
  meId,
  onRetract,
  onClose,
}: MemberGamesSheetProps) {
  const isMe = member.id === meId;
  const overall = recordFor(matches, member.id);
  const sorted = [...matches].sort((a, b) => b.playedAt - a.playedAt);
  const nameOf = (id: string) => members.find((candidate) => candidate.id === id)?.name ?? 'Someone';

  const perGame = GAME_TYPES.map((game) => ({
    game,
    record: recordFor(matches, member.id, game.key),
  })).filter((entry) => entry.record.wins > 0 || entry.record.losses > 0);

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${member.name}'s games`}
    >
      <div className="sheet stack" onClick={(event) => event.stopPropagation()}>
        <div className="row between">
          <div className="row" style={{ gap: '0.6rem' }}>
            <span
              className="swatch"
              style={{ background: member.color, height: 24 }}
              aria-hidden="true"
            />
            <strong>
              {member.name}
              {isMe && <span className="muted"> (you)</span>}
            </strong>
          </div>
          <button className="btn btn-ghost" style={{ minHeight: 36 }} onClick={onClose}>
            Close
          </button>
        </div>

        {sorted.length === 0 ? (
          <p className="tiny muted" style={{ margin: 0 }}>
            No games reported yet.
          </p>
        ) : (
          <>
            <p className="tiny muted" style={{ margin: 0 }}>
              {overall.wins} win{overall.wins === 1 ? '' : 's'} · {overall.losses} loss
              {overall.losses === 1 ? '' : 'es'}
              {perGame.length > 0 &&
                ` — ${perGame
                  .map((entry) => `${entry.game.label} ${entry.record.wins}-${entry.record.losses}`)
                  .join(', ')}`}
            </p>
            <div>
              {sorted.map((match) => {
                const type = getGameType(match.gameKey);
                const won = match.winnerIds.includes(member.id);
                const mySide = won ? match.winnerIds : match.loserIds;
                const otherSide = won ? match.loserIds : match.winnerIds;
                const teammates = mySide.filter((id) => id !== member.id).map(nameOf);
                const opponents = otherSide.map(nameOf);

                let detail = won ? 'Won' : 'Lost';
                if (teammates.length > 0) detail += ` with ${teammates.join(', ')}`;
                if (opponents.length > 0) detail += ` vs ${opponents.join(', ')}`;

                return (
                  <div className="log-row" key={match.id}>
                    <span>
                      <span aria-hidden="true">{type?.emoji ?? '🎮'}</span>{' '}
                      {type?.label ?? 'Game'} — {detail}
                      {match.note && <span className="muted"> · "{match.note}"</span>}
                    </span>
                    <span className="row" style={{ gap: '0.5rem' }}>
                      <span className="muted tiny">{formatClock(match.playedAt)}</span>
                      {match.reportedBy === meId && (
                        <button
                          className="btn btn-ghost tiny"
                          style={{ minHeight: 32, padding: '0.2rem 0.55rem' }}
                          onClick={() => onRetract(match.id)}
                          aria-label={`Retract ${type?.label ?? 'game'} at ${formatClock(match.playedAt)}`}
                        >
                          Retract
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
