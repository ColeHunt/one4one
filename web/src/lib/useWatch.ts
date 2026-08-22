import { useEffect, useState } from 'react';
import type { ServerMessage, WatchState } from '@shared/types.js';
import { RoomSocket, onWake, type ConnectionStatus } from './socket.js';

export interface WatchView {
  status: ConnectionStatus;
  state: WatchState | null;
  fatalError: string | null;
}

/**
 * Read-only counterpart to useRoom. A spectator sends nothing that mutates
 * anything, so there is no optimistic state, no pending/hidden bookkeeping,
 * and no callbacks to return — just what came back from the last snapshot.
 *
 * Both failure codes are treated as fatal here, unlike useRoom's narrower
 * FATAL_CODES: a spectator who fails to connect has no room content behind
 * the failure to keep showing, so there is nothing useful a transient toast
 * would be layered over.
 */
export function useWatch(token: string): WatchView {
  const [state, setState] = useState<WatchState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [fatalError, setFatalError] = useState<string | null>(null);

  useEffect(() => {
    const socket = new RoomSocket({ t: 'watch', token }, {
      onStatus: setStatus,
      onMessage: (message: ServerMessage) => {
        if (message.t === 'watch_state') {
          setState((current) => (current && current.rev > message.state.rev ? current : message.state));
        } else if (message.t === 'error') {
          setFatalError(message.message);
        }
      },
    });

    socket.connect();
    const stopWake = onWake(() => socket.poke());

    return () => {
      stopWake();
      socket.close();
    };
  }, [token]);

  return { status, state, fatalError };
}
