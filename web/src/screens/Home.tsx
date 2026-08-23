import { useState, type FormEvent } from 'react';
import { getRecentRooms } from '../lib/identity.js';

interface HomeProps {
  initialName: string;
  onEnter: (roomCode: string, name: string) => void;
}

export function Home({ initialName, onEnter }: HomeProps) {
  const [name, setName] = useState(initialName);
  const [roomName, setRoomName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recent = getRecentRooms();

  const displayName = name.trim() || 'Someone';

  async function startRoom() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim() || undefined }),
      });
      if (!response.ok) throw new Error('Could not start a room');
      const { code: newCode } = (await response.json()) as { code: string };
      onEnter(newCode, displayName);
    } catch {
      setError('Could not start a room. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event: FormEvent) {
    event.preventDefault();
    const cleaned = code.trim().toUpperCase();
    if (cleaned.length !== 6) {
      setError('Room codes are six characters.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/rooms/${cleaned}`);
      if (!response.ok) {
        setError('No room with that code. Check it and try again.');
        return;
      }
      onEnter(cleaned, displayName);
    } catch {
      setError('Could not reach the server. Check your connection.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="hero">
        <h1>one4one</h1>
        <p className="muted">Track the night together. One room, everyone's count.</p>
      </div>

      <div className="card">
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Who are you?"
            maxLength={24}
            autoComplete="nickname"
          />
        </label>
      </div>

      <div className="card stack">
        <label className="field">
          <span>Round name (optional)</span>
          <input
            value={roomName}
            onChange={(event) => setRoomName(event.target.value)}
            placeholder="Jake's birthday"
            maxLength={40}
          />
        </label>
        <button className="btn btn-primary btn-full" onClick={startRoom} disabled={busy}>
          Start a round
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>
          You'll get a six-character code to share with everyone else.
        </p>
      </div>

      <form className="card stack" onSubmit={joinRoom}>
        <h2>Join a room</h2>
        <input
          className="code-input"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase().slice(0, 6))}
          placeholder="ABC123"
          inputMode="text"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Room code"
        />
        <button className="btn btn-full" type="submit" disabled={busy}>
          Join
        </button>
      </form>

      {recent.length > 0 && (
        <div className="card">
          <h2>Recent</h2>
          <div className="stack">
            {recent.map((room) => (
              <button
                key={room.code}
                className="btn btn-ghost btn-full"
                onClick={() => onEnter(room.code, displayName)}
              >
                {room.code}
              </button>
            ))}
          </div>
        </div>
      )}

      {error && <p className="tiny" style={{ color: 'var(--danger)' }}>{error}</p>}

      <p className="tiny muted">
        Anyone with the room code can see the room. Rooms are deleted automatically after two days
        of inactivity.
      </p>
    </div>
  );
}
