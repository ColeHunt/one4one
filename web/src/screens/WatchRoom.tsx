import { useEffect, useMemo, useState } from 'react';
import { DrinkLog } from '../components/DrinkLog.js';
import { GamesScoreboard } from '../components/GamesScoreboard.js';
import { Leaderboard } from '../components/Leaderboard.js';
import { MemberDrinksSheet } from '../components/MemberDrinksSheet.js';
import { MemberGamesSheet } from '../components/MemberGamesSheet.js';
import { NightRecap } from '../components/NightRecap.js';
import { Timeline } from '../components/Timeline.js';
import { useWatch } from '../lib/useWatch.js';

interface WatchRoomProps {
  token: string;
  onLeave: () => void;
}

/**
 * No real member has this id, so every "is this you" / "is this yours" check
 * already built into the reused components — Leaderboard's "(you)" label,
 * MemberDrinksSheet's Undo button, MemberGamesSheet's Retract button — comes
 * out false on its own. Nothing extra to wire up for read-only mode.
 */
const NOBODY = '';

const STATUS_LABEL = {
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline — will retry',
} as const;

export function WatchRoom({ token, onLeave }: WatchRoomProps) {
  const { status, state, fatalError } = useWatch(token);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedGamesMemberId, setSelectedGamesMemberId] = useState<string | null>(null);
  const [showRecap, setShowRecap] = useState(false);

  const drinks = state?.drinks ?? [];
  const matches = state?.matches ?? [];
  const members = state?.members ?? [];

  // Same clock reconciliation Room.tsx uses, so the BAC chart doesn't skip a
  // drink logged between ticks or by a phone whose clock lags the server's.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => setTick(Date.now()), [drinks.length]);
  const now = useMemo(
    () => drinks.reduce((latest, drink) => Math.max(latest, drink.consumedAt), tick),
    [tick, drinks],
  );

  const selectedMember = members.find((member) => member.id === selectedMemberId) ?? null;
  const selectedMemberDrinks = useMemo(
    () => drinks.filter((drink) => drink.memberId === selectedMemberId),
    [drinks, selectedMemberId],
  );

  const selectedGamesMember = members.find((member) => member.id === selectedGamesMemberId) ?? null;
  const selectedGamesMemberMatches = useMemo(() => {
    if (!selectedGamesMemberId) return [];
    return matches.filter(
      (match) =>
        match.winnerIds.includes(selectedGamesMemberId) ||
        match.loserIds.includes(selectedGamesMemberId),
    );
  }, [matches, selectedGamesMemberId]);

  if (fatalError) {
    return (
      <div className="app">
        <div className="card stack" style={{ marginTop: '4rem' }}>
          <strong>{fatalError}</strong>
          <button className="btn btn-primary btn-full" onClick={onLeave}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="btn btn-ghost" style={{ minHeight: 36, padding: '0.3rem 0.7rem' }} onClick={onLeave}>
          ← Leave
        </button>
        <span className="brand">one4one</span>
        <span className="row tiny muted" style={{ gap: '0.35rem' }}>
          <span className={`status-dot ${status}`} aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
      </header>

      <div className="card row between">
        <div>
          {state?.name && <strong style={{ fontSize: '1.05rem' }}>{state.name}</strong>}
          <div className="row" style={{ gap: '0.5rem' }}>
            <div className="tiny muted">Watching</div>
            {state?.closedAt != null && <span className="closed-tag">Closed</span>}
          </div>
          <p className="tiny muted" style={{ margin: '0.3rem 0 0' }}>
            {state?.closedAt != null
              ? "This room is closed — nobody's logging anything new."
              : "You're viewing this room live. You can't log drinks, report games, or see the room code from here."}
          </p>
        </div>
        {state && (
          <button
            className="btn btn-ghost tiny"
            style={{ minHeight: 32, padding: '0.2rem 0.6rem', flex: 'none' }}
            onClick={() => setShowRecap(true)}
          >
            Recap
          </button>
        )}
      </div>

      {!state ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Connecting…</p>
        </div>
      ) : (
        <>
          <Leaderboard
            members={members}
            drinks={drinks}
            meId={NOBODY}
            now={now}
            onSelectMember={setSelectedMemberId}
          />
          <GamesScoreboard
            members={members}
            matches={matches}
            meId={NOBODY}
            onSelectMember={setSelectedGamesMemberId}
            readOnly
          />
          <Timeline members={members} drinks={drinks} meId={NOBODY} now={now} />
          <DrinkLog drinks={drinks} members={members} meId={NOBODY} onUndo={() => {}} />
        </>
      )}

      <p className="tiny muted">
        one4one is a counter, not a breathalyser or a medical device. If someone is in trouble —
        confused, vomiting, or hard to wake — call emergency services.
      </p>

      {selectedMember && (
        <MemberDrinksSheet
          member={selectedMember}
          drinks={selectedMemberDrinks}
          meId={NOBODY}
          onUndo={() => {}}
          onClose={() => setSelectedMemberId(null)}
        />
      )}

      {selectedGamesMember && (
        <MemberGamesSheet
          member={selectedGamesMember}
          matches={selectedGamesMemberMatches}
          members={members}
          meId={NOBODY}
          onRetract={() => {}}
          onClose={() => setSelectedGamesMemberId(null)}
        />
      )}

      {showRecap && (
        <NightRecap
          members={members}
          drinks={drinks}
          matches={matches}
          meId={NOBODY}
          now={now}
          onClose={() => setShowRecap(false)}
        />
      )}
    </div>
  );
}
