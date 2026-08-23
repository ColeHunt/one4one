import { useEffect, useMemo, useState } from 'react';
import { AddDrink } from '../components/AddDrink.js';
import { DrinkLog } from '../components/DrinkLog.js';
import { GamesScoreboard } from '../components/GamesScoreboard.js';
import { Leaderboard } from '../components/Leaderboard.js';
import { MeCard } from '../components/MeCard.js';
import { MemberDrinksSheet } from '../components/MemberDrinksSheet.js';
import { MemberGamesSheet } from '../components/MemberGamesSheet.js';
import { NightRecap } from '../components/NightRecap.js';
import { ProfileSheet } from '../components/ProfileSheet.js';
import { ReportMatchSheet } from '../components/ReportMatchSheet.js';
import { Timeline } from '../components/Timeline.js';
import { formatClock } from '../lib/format.js';
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
    closeRoom,
    reopenRoom,
    renameRoom,
  } = useRoom(roomCode, memberId, name);
  const closed = room?.closedAt != null;
  const [showProfile, setShowProfile] = useState(false);
  const [showReportMatch, setShowReportMatch] = useState(false);
  const [showRecap, setShowRecap] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedWatch, setCopiedWatch] = useState(false);
  const [editingRoomName, setEditingRoomName] = useState(false);
  const [roomNameDraft, setRoomNameDraft] = useState('');
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

  // A watch token, never the room code — see shared/src/types.ts on WatchState
  // for why that split exists. Only shown once the first snapshot has the
  // token in it, so there's never a moment where tapping this does nothing.
  async function shareWatchLink() {
    if (!room) return;
    const url = `${location.origin}/watch/${room.watchToken}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'one4one', text: 'Watch live — no need to join', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopiedWatch(true);
      window.setTimeout(() => setCopiedWatch(false), 2000);
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

      <div className="card stack">
        {room &&
          (editingRoomName ? (
            <form
              className="row"
              style={{ gap: '0.4rem' }}
              onSubmit={(event) => {
                event.preventDefault();
                renameRoom(roomNameDraft);
                setEditingRoomName(false);
              }}
            >
              <input
                value={roomNameDraft}
                onChange={(event) => setRoomNameDraft(event.target.value)}
                placeholder="Name this round"
                maxLength={40}
                autoFocus
                style={{ flex: 1 }}
              />
              <button
                type="submit"
                className="btn btn-ghost tiny"
                style={{ minHeight: 32, padding: '0.2rem 0.6rem', flex: 'none' }}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost tiny"
                style={{ minHeight: 32, padding: '0.2rem 0.6rem', flex: 'none' }}
                onClick={() => setEditingRoomName(false)}
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              onClick={() => {
                setRoomNameDraft(room.name ?? '');
                setEditingRoomName(true);
              }}
              style={{ textAlign: 'left', padding: 0, display: 'block' }}
              aria-label="Rename this round"
            >
              <strong style={{ fontSize: '1.05rem' }}>{room.name ?? 'Name this round'}</strong>{' '}
              <span className="muted tiny" aria-hidden="true">
                ✏️
              </span>
            </button>
          ))}
        <div className="row between">
          <div>
            <div className="row" style={{ gap: '0.5rem' }}>
              <div className="tiny muted">Room code</div>
              {closed && <span className="closed-tag">Closed</span>}
            </div>
            <div className="code-chip">{roomCode}</div>
          </div>
          <button className="btn" onClick={share}>
            {copied ? 'Copied' : 'Share'}
          </button>
        </div>
        {room && (
          <div className="row between">
            <p className="tiny muted" style={{ margin: 0 }}>
              Spectators can watch live without joining or seeing the code.
            </p>
            <button
              className="btn btn-ghost tiny"
              style={{ minHeight: 32, padding: '0.2rem 0.6rem', flex: 'none' }}
              onClick={shareWatchLink}
            >
              {copiedWatch ? 'Copied' : 'Spectator link'}
            </button>
          </div>
        )}
        {room && (
          <div className="row between">
            <p className="tiny muted" style={{ margin: 0 }}>
              See the whole night — drinks, peak BAC, and game records — in one place.
            </p>
            <button
              className="btn btn-ghost tiny"
              style={{ minHeight: 32, padding: '0.2rem 0.6rem', flex: 'none' }}
              onClick={() => setShowRecap(true)}
            >
              Recap
            </button>
          </div>
        )}
        {room && (
          <div className="row between">
            <p className="tiny muted" style={{ margin: 0 }}>
              {closed
                ? `Closed at ${formatClock(room.closedAt!)}. Reopen to log more.`
                : 'Closing freezes drinks and games so the recap stays put.'}
            </p>
            <button
              className="btn btn-ghost tiny"
              style={{ minHeight: 32, padding: '0.2rem 0.6rem', flex: 'none' }}
              onClick={() => {
                if (closed) {
                  reopenRoom();
                } else {
                  closeRoom();
                  setShowRecap(true);
                }
              }}
            >
              {closed ? 'Reopen' : 'Close room'}
            </button>
          </div>
        )}
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
            closed={closed}
          />
          {!closed && <AddDrink onAdd={addDrink} />}
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
            readOnly={closed}
          />
          <Timeline members={room.members} drinks={drinks} meId={memberId} now={now} />
          <DrinkLog
            drinks={drinks}
            members={room.members}
            meId={memberId}
            onUndo={undoDrink}
            closed={closed}
          />
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
          closed={closed}
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
          closed={closed}
        />
      )}

      {showRecap && room && (
        <NightRecap
          members={room.members}
          drinks={drinks}
          matches={matches}
          meId={memberId}
          now={now}
          onClose={() => setShowRecap(false)}
        />
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}
