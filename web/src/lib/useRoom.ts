import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Drink,
  Match,
  NewDrink,
  NewMatch,
  ProfilePatch,
  RoomState,
  ServerMessage,
} from '@shared/types.js';
import { resolveStandardDrinks } from '@shared/drinks.js';
import { RoomSocket, onWake, type ConnectionStatus } from './socket.js';
import { rememberRoom } from './identity.js';

export interface RoomView {
  status: ConnectionStatus;
  room: RoomState | null;
  /** Confirmed drinks, plus this device's in-flight ones, minus its undone ones. */
  drinks: Drink[];
  /** Reported game results. Unlike drinks, these have no optimistic local copy — see reportMatch. */
  matches: Match[];
  error: string | null;
  fatalError: string | null;
  addDrink: (drink: NewDrink) => void;
  undoDrink: (drinkId: string) => void;
  reportMatch: (match: NewMatch) => void;
  retractMatch: (matchId: string) => void;
  updateProfile: (patch: ProfilePatch) => void;
  closeRoom: () => void;
  reopenRoom: () => void;
  dismissError: () => void;
}

/** Errors that mean "this room will never work", as opposed to transient ones. */
const FATAL_CODES = new Set(['room_not_found', 'room_full']);

export function useRoom(roomCode: string, memberId: string, name: string): RoomView {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  /** Drinks sent but not yet reflected in a snapshot, keyed by client id. */
  const [pending, setPending] = useState<Drink[]>([]);
  /** Server drink ids we have asked to delete but still see in the snapshot. */
  const [hidden, setHidden] = useState<string[]>([]);

  const socketRef = useRef<RoomSocket | null>(null);
  const pendingRef = useRef<Drink[]>([]);
  pendingRef.current = pending;
  /**
   * Client ids undone before the server confirmed them. We cannot delete a
   * drink we have no server id for, so we remember the intent and issue the
   * delete the moment it shows up in a snapshot.
   */
  const cancelledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const socket = new RoomSocket({ t: 'join', roomCode, memberId, name }, {
      onStatus: setStatus,
      onMessage: (message: ServerMessage) => {
        if (message.t === 'state') {
          setRoom((current) => (current && current.rev > message.room.rev ? current : message.room));
          rememberRoom(message.room.code);

          const landedClientIds = new Set<string>();
          const serverIds = new Set<string>();
          for (const drink of message.room.drinks) {
            serverIds.add(drink.id);
            if (drink.clientId) landedClientIds.add(drink.clientId);
            // A drink undone while still in flight has arrived: delete it now.
            if (drink.clientId && cancelledRef.current.has(drink.clientId)) {
              cancelledRef.current.delete(drink.clientId);
              socketRef.current?.send({ t: 'undo_drink', drinkId: drink.id });
              setHidden((current) => (current.includes(drink.id) ? current : [...current, drink.id]));
            }
          }
          setPending((current) =>
            current.filter((drink) => !drink.clientId || !landedClientIds.has(drink.clientId)),
          );
          // Stop hiding ids the server has actually removed.
          setHidden((current) => current.filter((id) => serverIds.has(id)));
        } else if (message.t === 'error') {
          if (FATAL_CODES.has(message.code)) {
            setFatalError(message.message);
          } else {
            setError(message.message);
            // A rejected drink must not linger as an optimistic entry.
            if (
              message.code === 'bad_request' ||
              message.code === 'too_many_drinks' ||
              message.code === 'room_closed'
            ) {
              setPending([]);
            }
          }
        }
      },
    });

    socketRef.current = socket;
    socket.connect();
    const stopWake = onWake(() => socket.poke());

    return () => {
      stopWake();
      socket.close();
      socketRef.current = null;
    };
  }, [roomCode, memberId, name]);

  const addDrink = useCallback(
    (drink: NewDrink) => {
      const standardDrinks = resolveStandardDrinks(drink.kind, drink.volumeMl, drink.abv);
      if (standardDrinks == null) {
        setError('That is not a drink we can measure');
        return;
      }
      const clientId = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      setPending((current) => [
        ...current,
        {
          id: clientId,
          memberId,
          kind: drink.kind,
          standardDrinks,
          volumeMl: drink.volumeMl ?? null,
          abv: drink.abv ?? null,
          consumedAt: drink.consumedAt ?? Date.now(),
          clientId,
        },
      ]);
      socketRef.current?.send({ t: 'add_drink', drink: { ...drink, clientId } });
    },
    [memberId],
  );

  const undoDrink = useCallback((drinkId: string) => {
    const inFlight = pendingRef.current.find((drink) => drink.id === drinkId);
    if (inFlight) {
      // The server has no id for this yet; cancel it when the snapshot arrives.
      if (inFlight.clientId) cancelledRef.current.add(inFlight.clientId);
      setPending((current) => current.filter((drink) => drink.id !== drinkId));
      return;
    }
    setHidden((current) => (current.includes(drinkId) ? current : [...current, drinkId]));
    socketRef.current?.send({ t: 'undo_drink', drinkId });
  }, []);

  const updateProfile = useCallback((patch: ProfilePatch) => {
    socketRef.current?.send({ t: 'update_profile', patch });
  }, []);

  // Matches are reported far less often than drinks are logged, so the round
  // trip to the server and back is imperceptible on a live room — these send
  // and wait for the next snapshot, the same simple pattern updateProfile
  // already uses, rather than duplicating addDrink's optimistic/pending/
  // cancelled machinery for a second data type.
  const reportMatch = useCallback((match: NewMatch) => {
    socketRef.current?.send({ t: 'report_match', match });
  }, []);

  const retractMatch = useCallback((matchId: string) => {
    socketRef.current?.send({ t: 'retract_match', matchId });
  }, []);

  const closeRoom = useCallback(() => {
    socketRef.current?.send({ t: 'close_room' });
  }, []);

  const reopenRoom = useCallback(() => {
    socketRef.current?.send({ t: 'reopen_room' });
  }, []);

  const matches = room?.matches ?? [];

  const drinks = useMemo(() => {
    const hiddenSet = new Set(hidden);
    const confirmed = (room?.drinks ?? []).filter((drink) => !hiddenSet.has(drink.id));
    if (pending.length === 0) return confirmed;
    return [...confirmed, ...pending].sort((a, b) => a.consumedAt - b.consumedAt);
  }, [room, pending, hidden]);

  const dismissError = useCallback(() => setError(null), []);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 4000);
    return () => window.clearTimeout(timer);
  }, [error]);

  return {
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
    dismissError,
  };
}
