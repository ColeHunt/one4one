import type { ClientMessage, ServerMessage } from '@shared/types.js';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

interface RoomSocketHandlers {
  onMessage: (message: ServerMessage) => void;
  onStatus: (status: ConnectionStatus) => void;
}

const MAX_BACKOFF_MS = 15_000;

/**
 * A WebSocket that reconnects with backoff, re-joins its room automatically and
 * queues mutations made while offline so nothing is lost in a dead-signal bar.
 */
export class RoomSocket {
  private socket: WebSocket | null = null;
  private queue: ClientMessage[] = [];
  private attempts = 0;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private closedByUs = false;

  /**
   * `helloMessage` is sent (and re-sent on every reconnect) as the first thing
   * on the wire — a member's `join` or a spectator's `watch`. The socket itself
   * doesn't care which; it only needs something to say hello with.
   */
  constructor(
    private readonly helloMessage: ClientMessage,
    private readonly handlers: RoomSocketHandlers,
  ) {}

  connect(): void {
    this.closedByUs = false;
    this.openSocket();
  }

  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.socket?.close();
    this.socket = null;
  }

  /** Reconnect immediately if the socket is not open — used when the tab wakes. */
  poke(): void {
    if (this.closedByUs) return;
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) return;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.attempts = 0;
    this.openSocket();
  }

  /** Sends now if connected, otherwise queues until the next successful join. */
  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
      return;
    }
    this.queue.push(message);
  }

  private openSocket(): void {
    this.handlers.onStatus(this.attempts === 0 ? 'connecting' : 'offline');

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.handlers.onStatus('online');
      socket.send(JSON.stringify(this.helloMessage));
      const pending = this.queue;
      this.queue = [];
      for (const message of pending) socket.send(JSON.stringify(message));

      this.heartbeatTimer = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ t: 'ping' }));
      }, 25_000);
    };

    socket.onmessage = (event) => {
      try {
        this.handlers.onMessage(JSON.parse(String(event.data)) as ServerMessage);
      } catch {
        // Ignore anything we cannot parse.
      }
    };

    socket.onclose = () => {
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
      if (this.closedByUs) return;
      this.handlers.onStatus('offline');
      this.scheduleReconnect();
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private scheduleReconnect(): void {
    this.attempts += 1;
    const base = Math.min(500 * 2 ** (this.attempts - 1), MAX_BACKOFF_MS);
    // Jitter keeps a whole table's phones from reconnecting in lockstep.
    const delay = base * (0.7 + Math.random() * 0.6);
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
  }
}

/** Reconnects promptly when the phone comes back from sleep or regains signal. */
export function onWake(callback: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') callback();
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('online', callback);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('online', callback);
  };
}
