import { useState } from 'react';
import { GAME_TYPES } from '@shared/games.js';
import type { Member, NewMatch } from '@shared/types.js';

interface ReportMatchSheetProps {
  members: Member[];
  onReport: (match: NewMatch) => void;
  onClose: () => void;
}

export function ReportMatchSheet({ members, onReport, onClose }: ReportMatchSheetProps) {
  const [gameKey, setGameKey] = useState<string | null>(null);
  const [winnerIds, setWinnerIds] = useState<string[]>([]);
  const [loserIds, setLoserIds] = useState<string[]>([]);
  const [note, setNote] = useState('');

  function toggle(id: string, side: 'winner' | 'loser') {
    const [set, setSet, otherSet, setOtherSet] =
      side === 'winner'
        ? [winnerIds, setWinnerIds, loserIds, setLoserIds]
        : [loserIds, setLoserIds, winnerIds, setWinnerIds];
    if (set.includes(id)) {
      setSet(set.filter((memberId) => memberId !== id));
      return;
    }
    setSet([...set, id]);
    // A member can't be on both sides of the same match.
    if (otherSet.includes(id)) setOtherSet(otherSet.filter((memberId) => memberId !== id));
  }

  const canSubmit = gameKey != null && loserIds.length > 0;

  function submit() {
    if (!canSubmit || gameKey == null) return;
    onReport({ gameKey, winnerIds, loserIds, note: note.trim() || null });
    onClose();
  }

  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Report a game"
    >
      <div className="sheet stack" onClick={(event) => event.stopPropagation()}>
        <div className="row between">
          <strong>Report a game</strong>
          <button className="btn btn-ghost" style={{ minHeight: 36 }} onClick={onClose}>
            Close
          </button>
        </div>

        <div className="field">
          <span>Game</span>
          <div className="game-grid">
            {GAME_TYPES.map((game) => (
              <button
                key={game.key}
                className="game-btn"
                aria-pressed={gameKey === game.key}
                onClick={() => setGameKey(game.key)}
              >
                <span className="emoji" aria-hidden="true">
                  {game.emoji}
                </span>
                <span className="label">{game.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Winners (optional — some games don't have one)</span>
          <div className="chip-row">
            {members.map((member) => (
              <button
                key={member.id}
                className="member-chip"
                aria-pressed={winnerIds.includes(member.id)}
                disabled={loserIds.includes(member.id)}
                onClick={() => toggle(member.id, 'winner')}
              >
                <span className="chip-swatch" style={{ background: member.color }} aria-hidden="true" />
                {member.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Losers</span>
          <div className="chip-row">
            {members.map((member) => (
              <button
                key={member.id}
                className="member-chip"
                aria-pressed={loserIds.includes(member.id)}
                disabled={winnerIds.includes(member.id)}
                onClick={() => toggle(member.id, 'loser')}
              >
                <span className="chip-swatch" style={{ background: member.color }} aria-hidden="true" />
                {member.name}
              </button>
            ))}
          </div>
        </div>

        <label className="field">
          <span>Note (optional)</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything worth remembering"
            maxLength={140}
          />
        </label>

        <p className="tiny muted" style={{ margin: 0 }}>
          Anyone in the room can report a result — same honor system as the drink log. Only you can
          retract a game you reported.
        </p>

        <button className="btn btn-primary btn-full" onClick={submit} disabled={!canSubmit}>
          Report result
        </button>
      </div>
    </div>
  );
}
