/**
 * A WebSocket to the multiplayer server that reconnects by itself and
 * re-attaches (host / join) after every reconnect.
 */

import type { RelayClientMessage, RelayServerMessage } from '@memizy/protocol';

export type RelayStatus = 'connecting' | 'online' | 'offline' | 'closed';

export interface RelaySocketOptions {
  /** `ws(s)://…/ws` */
  url: string;
  /** The attach message sent after every (re)connect. */
  attach: () => RelayClientMessage;
  WebSocket?: typeof WebSocket;
}

const PING_MS = 20_000;

export class RelaySocket {
  status: RelayStatus = 'connecting';
  private readonly options: RelaySocketOptions;
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
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
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    this.ws?.close(1000, 'bye');
    this.setStatus('closed');
  }

  /** Reconnects right away (e.g. when the page becomes visible again). */
  reconnectNow(): void {
    if (this.stopped || this.status === 'online' || this.status === 'connecting') return;
    clearTimeout(this.retryTimer);
    this.open();
  }

  private setStatus(status: RelayStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private open(): void {
    if (this.stopped) return;
    this.setStatus('connecting');
    const Impl = this.options.WebSocket ?? WebSocket;
    const ws = new Impl(this.options.url);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      ws.send(JSON.stringify(this.options.attach()));
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      let msg: RelayServerMessage;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.t === 'hosting' || msg.t === 'joined') {
        this.retry = 0;
        this.setStatus('online');
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send({ t: 'ping' }), PING_MS);
      }
      if ((msg.t === 'error' && msg.fatal) || msg.t === 'closed') this.stopped = true;
      for (const listener of this.messageListeners) listener(msg);
      if (this.stopped) this.close();
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      if (this.stopped) {
        this.setStatus('closed');
        return;
      }
      this.setStatus('offline');
      const delay = Math.min(5000, 300 * 2 ** this.retry++) + Math.random() * 300;
      this.retryTimer = setTimeout(() => this.open(), delay);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }
}

/** `http(s)://server` → `ws(s)://server/ws` */
export function relayWebSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/ws`;
  return url.href;
}
