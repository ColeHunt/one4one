import { useEffect, useMemo, useState } from 'react';
import { AddDrink } from '../components/AddDrink.js';
import { DrinkLog } from '../components/DrinkLog.js';
import { GamesScoreboard } from '../components/GamesScoreboard.js';
import { Leaderboard } from '../components/Leaderboard.js';
import { MeCard } from '../components/MeCard.js';
import { MemberDrinksSheet } from '../components/MemberDrinksSheet.js';
import { MemberGamesSheet } from '../components/MemberGamesSheet.js';
import { ProfileSheet } from '../components/ProfileSheet.js';
import { ReportMatchSheet } from '../components/ReportMatchSheet.js';
import { Timeline } from '../components/Timeline.js';
import { useRoom } from '../lib/useRoom.js';

interface RoomProps {
  roomCode: string;
  memberId: string;
  name: string;
  onLeave: () => void;
}

const STATUS_LABEL = {
  connecting: 'Connecting…',
  online: 'Live',
  offline: 'Offline — will retry',
} as const;

export function Room({ roomCode, memberId, name, onLeave }: RoomProps) {
  const {
    status,
    room,
    drinks,
    matches,
    error,
    fatalError,
    addDrink,
    undoDrink,
    reportMatch,
    retractMatch,
    updateProfile,
  } = useRoom(roomCode, memberId, name);
  const [showProfile, setShowProfile] = useState(false);
  const [showReportMatch, setShowReportMatch] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [selectedGamesMemberId, setSelectedGamesMemberId] = useState<string | null>(null);

  // BAC decays with the clock, so the view has to re-render without new data.
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // A drink logged between ticks would otherwise sit in the future and be
  // skipped by the estimate; the same holds for a phone whose clock lags the
  // server's, which stamps everyone's drinks.
  useEffect(() => setTick(Date.now()), [drinks.length]);
  const now = useMemo(
    () => drinks.reduce((latest, drink) => Math.max(latest, drink.consumedAt), tick),
    [tick, drinks],
  );

  const me = room?.members.find((member) => member.id === memberId) ?? null;
  const myDrinks = useMemo(
    () => drinks.filter((drink) => drink.memberId === memberId),
    [drinks, memberId],
  );

  const selectedMember = room?.members.find((member) => member.id === selectedMemberId) ?? null;
  const selectedMemberDrinks = useMemo(
    () => drinks.filter((drink) => drink.memberId === selectedMemberId),
    [drinks, selectedMemberId],
  );

  const selectedGamesMember =
    room?.members.find((member) => member.id === selectedGamesMemberId) ?? null;
  const selectedGamesMemberMatches = useMemo(() => {
    if (!selectedGamesMemberId) return [];
    return matches.filter(
      (match) =>
        match.winnerIds.includes(selectedGamesMemberId) ||
        match.loserIds.includes(selectedGamesMemberId),
    );
  }, [matches, selectedGamesMemberId]);

  async function share() {
    const url = `${location.origin}/r/${roomCode}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'one4one', text: `Join my round: ${roomCode}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // The user dismissed the share sheet, or the clipboard is unavailable.
    }
  }

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
          <div className="tiny muted">Room code</div>
          <div className="code-chip">{roomCode}</div>
        </div>
        <button className="btn" onClick={share}>
          {copied ? 'Copied' : 'Share'}
        </button>
      </div>

      {!room ? (
        <div className="card">
          <p className="muted" style={{ margin: 0 }}>Joining the room…</p>
        </div>
      ) : (
        <>
          <MeCard
            me={me}
            myDrinks={myDrinks}
            now={now}
            onOpenProfile={() => setShowProfile(true)}
            onUndo={() => {
              const last = [...myDrinks].sort((a, b) => b.consumedAt - a.consumedAt)[0];
              if (last) undoDrink(last.id);
            }}
          />
          <AddDrink onAdd={addDrink} />
          <Leaderboard
            members={room.members}
            drinks={drinks}
            meId={memberId}
            now={now}
            onSelectMember={setSelectedMemberId}
          />
          <GamesScoreboard
            members={room.members}
            matches={matches}
            meId={memberId}
            onSelectMember={setSelectedGamesMemberId}
            onReportGame={() => setShowReportMatch(true)}
          />
          <Timeline members={room.members} drinks={drinks} meId={memberId} now={now} />
          <DrinkLog drinks={drinks} members={room.members} meId={memberId} onUndo={undoDrink} />
        </>
      )}

      <p className="tiny muted">
        one4one is a counter, not a breathalyser or a medical device. If someone is in trouble —
        confused, vomiting, or hard to wake — call emergency services.
      </p>

      {showProfile && me && (
        <ProfileSheet me={me} onSave={updateProfile} onClose={() => setShowProfile(false)} />
      )}

      {selectedMember && (
        <MemberDrinksSheet
          member={selectedMember}
          drinks={selectedMemberDrinks}
          meId={memberId}
          onUndo={undoDrink}
          onClose={() => setSelectedMemberId(null)}
        />
      )}

      {showReportMatch && room && (
        <ReportMatchSheet
          members={room.members}
          onReport={reportMatch}
          onClose={() => setShowReportMatch(false)}
        />
      )}

      {selectedGamesMember && (
        <MemberGamesSheet
          member={selectedGamesMember}
          matches={selectedGamesMemberMatches}
          members={room?.members ?? []}
          meId={memberId}
          onRetract={retractMatch}
          onClose={() => setSelectedGamesMemberId(null)}
        />
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}
