import { useCallback, useEffect, useState } from 'react';
import { Home } from './screens/Home.js';
import { Room } from './screens/Room.js';
import { getMemberId, getStoredName, storeName } from './lib/identity.js';

/** Room codes live at /r/CODE so a room is a shareable link. */
function readRoomCode(): string | null {
  const match = /^\/r\/([0-9a-zA-Z]{6})$/.exec(location.pathname);
  return match ? match[1]!.toUpperCase() : null;
}

export function App() {
  const [roomCode, setRoomCode] = useState<string | null>(readRoomCode);
  const [name, setName] = useState<string>(getStoredName);
  const memberId = getMemberId();

  useEffect(() => {
    const onPop = () => setRoomCode(readRoomCode());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const enterRoom = useCallback((code: string, displayName: string) => {
    storeName(displayName);
    setName(displayName);
    setRoomCode(code);
    history.pushState({}, '', `/r/${code}`);
  }, []);

  const leaveRoom = useCallback(() => {
    setRoomCode(null);
    history.pushState({}, '', '/');
  }, []);

  if (!roomCode) return <Home onEnter={enterRoom} initialName={name} />;

  return (
    <Room
      key={roomCode}
      roomCode={roomCode}
      memberId={memberId}
      name={name || 'Someone'}
      onLeave={leaveRoom}
    />
  );
}
