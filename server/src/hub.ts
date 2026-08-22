import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { config } from './config.js';
import { isValidId, isValidRoomCode, normaliseRoomCode } from './ids.js';
import {
  RoomError,
  addDrink,
  getRoomState,
  joinRoom,
  removeDrink,
  updateProfile,
} from './rooms.js';
import type { ClientMessage, ServerErrorCode, ServerMessage } from '../../shared/src/types.js';

interface Session {
  socket: WebSocket;
  roomCode: string | null;
  memberId: string | null;
  alive: boolean;
  windowStart: number;
  messagesInWindow: number;
}

const sessions = new Map<WebSocket, Session>();

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendError(socket: WebSocket, code: ServerErrorCode, message: string): void {
  send(socket, { t: 'error', code, message });
}

/**
 * Push a fresh snapshot to every session in a room. Serialisation happens per
 * viewer because members who opted out of BAC sharing have their weight and sex
 * redacted for everyone else.
 */
export function broadcastRoom(roomCode: string): void {
  for (const session of sessions.values()) {
    if (session.roomCode !== roomCode || !session.memberId) continue;
    try {
      send(session.socket, {
        t: 'state',
        room: getRoomState(roomCode, session.memberId),
        you: session.memberId,
      });
    } catch {
      // Room disappeared underneath us (purged); drop the session's binding.
      session.roomCode = null;
    }
  }
}

function withinRateLimit(session: Session, now: number): boolean {
  if (now - session.windowStart >= 60_000) {
    session.windowStart = now;
    session.messagesInWindow = 0;
  }
  session.messagesInWindow += 1;
  return session.messagesInWindow <= config.messagesPerMinute;
}

function handleMessage(session: Session, raw: string): void {
  const now = Date.now();
  if (!withinRateLimit(session, now)) {
    sendError(session.socket, 'rate_limited', 'Slow down a moment');
    return;
  }

  let message: ClientMessage;
  try {
    message = JSON.parse(raw) as ClientMessage;
  } catch {
    sendError(session.socket, 'bad_request', 'Malformed message');
    return;
  }

  try {
    switch (message?.t) {
      case 'ping':
        send(session.socket, { t: 'pong' });
        return;

      case 'join': {
        const code = normaliseRoomCode(String(message.roomCode ?? ''));
        if (!isValidRoomCode(code)) {
          sendError(session.socket, 'room_not_found', 'That room code does not look right');
          return;
        }
        if (!isValidId(message.memberId)) {
          sendError(session.socket, 'bad_request', 'Bad member id');
          return;
        }
        joinRoom(code, message.memberId, String(message.name ?? ''), now);
        session.roomCode = code;
        session.memberId = message.memberId;
        broadcastRoom(code);
        return;
      }

      case 'add_drink': {
        const { roomCode, memberId } = requireJoined(session);
        addDrink(roomCode, memberId, message.drink ?? { kind: '' }, now);
        broadcastRoom(roomCode);
        return;
      }

      case 'undo_drink': {
        const { roomCode, memberId } = requireJoined(session);
        removeDrink(roomCode, memberId, String(message.drinkId ?? ''), now);
        broadcastRoom(roomCode);
        return;
      }

      case 'update_profile': {
        const { roomCode, memberId } = requireJoined(session);
        updateProfile(roomCode, memberId, message.patch ?? {}, now);
        broadcastRoom(roomCode);
        return;
      }

      default:
        sendError(session.socket, 'bad_request', 'Unknown message');
    }
  } catch (error) {
    if (error instanceof RoomError) {
      sendError(session.socket, error.code, error.message);
      return;
    }
    console.error('ws handler failed', error);
    sendError(session.socket, 'bad_request', 'Something went wrong');
  }
}

function requireJoined(session: Session): { roomCode: string; memberId: string } {
  if (!session.roomCode || !session.memberId) {
    throw new RoomError('not_joined', 'Join a room first');
  }
  return { roomCode: session.roomCode, memberId: session.memberId };
}

export function attachHub(wss: WebSocketServer): () => void {
  wss.on('connection', (socket: WebSocket, _request: IncomingMessage) => {
    const session: Session = {
      socket,
      roomCode: null,
      memberId: null,
      alive: true,
      windowStart: Date.now(),
      messagesInWindow: 0,
    };
    sessions.set(socket, session);

    socket.on('message', (data, isBinary) => {
      if (isBinary) return;
      const raw = data.toString();
      if (raw.length > config.maxMessageBytes) {
        sendError(socket, 'bad_request', 'Message too large');
        return;
      }
      handleMessage(session, raw);
    });

    socket.on('pong', () => {
      session.alive = true;
    });

    socket.on('close', () => {
      sessions.delete(socket);
    });

    socket.on('error', () => {
      sessions.delete(socket);
    });
  });

  // Drop connections that stopped answering, so phones that went into a tunnel
  // do not accumulate as ghost sessions.
  const heartbeat = setInterval(() => {
    for (const session of sessions.values()) {
      if (!session.alive) {
        session.socket.terminate();
        continue;
      }
      session.alive = false;
      session.socket.ping();
    }
  }, 30_000);

  return () => clearInterval(heartbeat);
}
