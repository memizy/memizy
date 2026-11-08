/**
 * A WebSocket to the multiplayer server that reconnects by itself and
 * re-attaches (host / join) after every reconnect.
 *
 * A connection can die without a close: a phone that slept or switched networks keeps a
 * socket that looks open but carries nothing (half-open), sometimes for minutes. A heartbeat
 * finds it (a ping that hears nothing back), and `reconnectNow()` checks it at once when the
 * page comes back; a dead socket is dropped and a new one attaches with the same token.
 */

import type { RelayClientMessage, RelayServerMessage } from '@memizy/protocol';

/** `replaced`: the same host or player connected from another tab or device; this one stops. */
export type RelayStatus = 'connecting' | 'online' | 'offline' | 'closed' | 'replaced';

export interface RelaySocketOptions {
  /** `ws(s)://…/ws` */
  url: string;
  /** The attach message sent after every (re)connect. */
  attach: () => RelayClientMessage;
  WebSocket?: typeof WebSocket;
}

/**
 * Timing of the connection checks (ms). Internal; tests shorten it. A heartbeat change takes
 * effect at the next (re)connect or `reconnectNow()`.
 */
export const RELAY_SOCKET_TIMING = {
  /** A ping this often while online (the server answers with a pong). */
  pingMs: 15_000,
  /** Nothing heard this long after a ping: the connection is dead. */
  deadMs: 8_000,
  /** `reconnectNow()` on an open connection: nothing heard this long after its ping: dead. */
  probeMs: 4_000,
  /** A connection that is not attached (online) after this long is given up and retried. */
  connectMs: 10_000,
};

export class RelaySocket {
  status: RelayStatus = 'connecting';
  private readonly options: RelaySocketOptions;
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  /** Runs while a ping waits for any message back; when it fires, the connection is dead. */
  private deadTimer: ReturnType<typeof setTimeout> | undefined;
  private deadAt = 0;
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly messageListeners = new Set<(msg: RelayServerMessage) => void>();
  private readonly statusListeners = new Set<(status: RelayStatus) => void>();

  constructor(options: RelaySocketOptions) {
    this.options = options;
    this.open();
  }

  onMessage(listener: (msg: RelayServerMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStatus(listener: (status: RelayStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  /** Sends when online; returns `false` when the message was dropped. */
  send(msg: RelayClientMessage): boolean {
    if (this.status !== 'online' || this.ws?.readyState !== 1) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Stops for good (no reconnect). */
  close(): void {
    this.stopped = true;
    this.clearTimers();
    this.ws?.close(1000, 'bye');
    this.setStatus('closed');
  }

  /**
   * Call when the page becomes visible again or the network comes back. Offline: reconnects
   * right away. Online: checks the connection (it may have died while the device slept) and
   * reconnects if nothing comes back. Connecting for too long: starts again.
   */
  reconnectNow(): void {
    if (this.stopped) return;
    if (this.status === 'online' && this.ws) {
      this.startHeartbeat();
      this.ping(RELAY_SOCKET_TIMING.probeMs);
      return;
    }
    if (this.status === 'connecting') return; // the connect timeout gives up on a stuck attempt
    clearTimeout(this.retryTimer);
    this.open();
  }

  private setStatus(status: RelayStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private clearTimers(): void {
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    clearTimeout(this.deadTimer);
    clearTimeout(this.connectTimer);
    this.deadTimer = undefined;
  }

  private startHeartbeat(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = setInterval(() => this.ping(RELAY_SOCKET_TIMING.deadMs), RELAY_SOCKET_TIMING.pingMs);
  }

  /** Sends a ping; if no message at all arrives within `waitMs`, the connection is dead. */
  private ping(waitMs: number): void {
    const ws = this.ws;
    if (!ws || !this.send({ t: 'ping' })) return;
    const deadAt = Date.now() + waitMs;
    if (this.deadTimer !== undefined && this.deadAt <= deadAt) return; // an earlier ping waits less
    clearTimeout(this.deadTimer);
    this.deadAt = deadAt;
    this.deadTimer = setTimeout(() => {
      this.deadTimer = undefined;
      if (this.ws === ws) this.lost(ws);
    }, waitMs);
  }

  private open(): void {
    if (this.stopped) return;
    this.setStatus('connecting');
    const Impl = this.options.WebSocket ?? WebSocket;
    const ws = new Impl(this.options.url);
    this.ws = ws;
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (this.ws === ws && this.status !== 'online') this.lost(ws);
    }, RELAY_SOCKET_TIMING.connectMs);
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify(this.options.attach()));
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      clearTimeout(this.deadTimer); // anything heard proves the connection lives
      this.deadTimer = undefined;
      let msg: RelayServerMessage;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.t === 'hosting' || msg.t === 'joined') {
        this.retry = 0;
        clearTimeout(this.connectTimer);
        this.setStatus('online');
        this.startHeartbeat();
      }
      if ((msg.t === 'error' && msg.fatal) || msg.t === 'closed') this.stopped = true;
      for (const listener of this.messageListeners) listener(msg);
      if (this.stopped) this.close();
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      // Reconnecting would take the room back from the newer connection, which would
      // reconnect too: two tabs would push each other out forever.
      if (event.reason?.startsWith('replaced')) {
        this.clearTimers();
        this.ws = null;
        this.stopped = true;
        this.setStatus('replaced');
        return;
      }
      this.lost(ws);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  /** The connection closed or died: forget it and connect again (unless stopped). */
  private lost(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.clearTimers();
    this.ws = null;
    try {
      ws.close(); // a dead socket may never confirm; its events are ignored from now on
    } catch {
      /* already closed */
    }
    if (this.stopped) {
      this.setStatus('closed');
      return;
    }
    this.setStatus('offline');
    const delay = Math.min(5000, 300 * 2 ** this.retry++) + Math.random() * 300;
    this.retryTimer = setTimeout(() => this.open(), delay);
  }
}

/** `http(s)://server` → `ws(s)://server/ws` */
export function relayWebSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  return url.href;
}
