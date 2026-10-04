/**
 * The relay core: rooms, players, forwarding, limits and the HTTP API.
 * Independent of the runtime: `main.ts` plugs it into Bun.serve, tests can
 * drive it with fake connections.
 */

import {
  RELAY_LIMITS,
  RELAY_PROTOCOL,
  RateLimiter,
  extractManifestFromHtml,
  isPin,
  normalizePlayerName,
  type CreateRoomResponse,
  type RelayClientMessage,
  type RelayErrorCode,
  type RelayPlayer,
  type RelayServerMessage,
  type RoomInfo,
} from '@memizy/protocol';

export interface RelayOptions {
  /** Allowed `Origin` values, or `'*'` (development only). */
  allowedOrigins: string[] | '*';
  /** Rooms one IP may create per hour (a school shares one IP: keep it generous). */
  roomsPerIpPerHour?: number;
  now?: () => number;
  log?: (message: string) => void;
}

/** One WebSocket connection as the core sees it. */
export interface RelayConnection {
  send(text: string): void;
  close(code: number, reason: string): void;
  readonly ip: string;
}

interface Player {
  id: string;
  name: string;
  token: string;
  conn: RelayConnection | null;
}

interface Room {
  pin: string;
  hostToken: string;
  createdAt: number;
  host: RelayConnection | null;
  hostAwaySince: number | null;
  open: boolean;
  players: Map<string, Player>;
  kickedTokens: Set<string>;
  bundle: { text: string; version: number; appName: string | null } | null;
}

interface ConnState {
  role: 'none' | 'host' | 'player';
  room: Room | null;
  playerId: string | null;
  limiter: RateLimiter;
}

const CLOSE_NORMAL = 1000;
const CLOSE_POLICY = 4000;

function randomId(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), { ...init, headers: { 'Content-Type': 'application/json; charset=utf-8', ...init.headers } });
}

export class RelayServer {
  private readonly options: RelayOptions;
  private readonly now: () => number;
  private readonly rooms = new Map<string, Room>();
  private readonly conns = new Map<RelayConnection, ConnState>();
  private readonly roomsByIp = new Map<string, number[]>();

  constructor(options: RelayOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
  }

  get stats(): { rooms: number; connections: number; players: number } {
    let players = 0;
    for (const room of this.rooms.values()) players += room.players.size;
    return { rooms: this.rooms.size, connections: this.conns.size, players };
  }

  private log(message: string): void {
    this.options.log?.(message);
  }

  // ==========================================================================
  // Origin
  // ==========================================================================

  isOriginAllowed(origin: string | null): boolean {
    if (this.options.allowedOrigins === '*') return true;
    return origin !== null && this.options.allowedOrigins.includes(origin);
  }

  private cors(origin: string | null): Record<string, string> {
    if (!origin || !this.isOriginAllowed(origin)) return {};
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Expose-Headers': 'X-Bundle-Version',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  }

  // ==========================================================================
  // HTTP API
  // ==========================================================================

  /** Handles `/api/*` requests; returns `null` for other paths. */
  async handleHttp(request: Request, ip: string): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return null;
    const origin = request.headers.get('Origin');
    const headers = this.cors(origin);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (url.pathname === '/api/health') return json({ ok: true, ...this.stats }, { headers });
    if (origin !== null && !this.isOriginAllowed(origin)) return json({ error: 'Origin not allowed' }, { status: 403 });

    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      if (!this.allowRoomCreation(ip)) return json({ error: 'Too many rooms from this network, try again later.' }, { status: 429, headers });
      return json(this.createRoom(), { status: 201, headers });
    }

    const match = /^\/api\/rooms\/([^/]+)(\/bundle)?$/.exec(url.pathname);
    if (!match) return json({ error: 'Not found' }, { status: 404, headers });
    const room = isPin(match[1]) ? this.rooms.get(match[1]) : undefined;
    if (!room) return json({ error: 'Room not found' }, { status: 404, headers });

    if (!match[2] && request.method === 'GET') return json(this.roomInfo(room), { headers });

    if (match[2] && request.method === 'GET') {
      if (!room.bundle) return json({ error: 'The host has not chosen a game yet' }, { status: 404, headers });
      return new Response(room.bundle.text, {
        headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Bundle-Version': String(room.bundle.version) },
      });
    }

    if (match[2] && request.method === 'PUT') {
      if (request.headers.get('Authorization') !== `Bearer ${room.hostToken}`) return json({ error: 'Not the host' }, { status: 403, headers });
      const length = Number(request.headers.get('Content-Length') ?? 0);
      if (length > RELAY_LIMITS.bundleBytes) return json({ error: 'Bundle too large' }, { status: 413, headers });
      const text = await request.text();
      if (new TextEncoder().encode(text).length > RELAY_LIMITS.bundleBytes) return json({ error: 'Bundle too large' }, { status: 413, headers });
      let bundle: unknown;
      try {
        bundle = JSON.parse(text);
      } catch {
        return json({ error: 'Invalid JSON' }, { status: 400, headers });
      }
      const b = bundle as { pluginHtml?: unknown; set?: unknown };
      if (typeof b.pluginHtml !== 'string' || typeof b.set !== 'object' || b.set === null) {
        return json({ error: 'Expected { pluginHtml: string, set: object }' }, { status: 400, headers });
      }
      const manifest = extractManifestFromHtml(b.pluginHtml);
      const appName = manifest.success ? String((manifest.data as { appName?: unknown }).appName ?? '') || null : null;
      const version = (room.bundle?.version ?? 0) + 1;
      room.bundle = { text, version, appName };
      return json({ version }, { headers });
    }

    return json({ error: 'Method not allowed' }, { status: 405, headers });
  }

  private allowRoomCreation(ip: string): boolean {
    const limit = this.options.roomsPerIpPerHour ?? 60;
    const hourAgo = this.now() - 3_600_000;
    const recent = (this.roomsByIp.get(ip) ?? []).filter((t) => t > hourAgo);
    if (recent.length >= limit) return false;
    recent.push(this.now());
    this.roomsByIp.set(ip, recent);
    return true;
  }

  createRoom(): CreateRoomResponse {
    let pin: string;
    do pin = String(100_000 + Math.floor(Math.random() * 900_000));
    while (this.rooms.has(pin));
    const room: Room = {
      pin,
      hostToken: randomId(24),
      createdAt: this.now(),
      host: null,
      hostAwaySince: this.now(),
      open: true,
      players: new Map(),
      kickedTokens: new Set(),
      bundle: null,
    };
    this.rooms.set(pin, room);
    this.log(`room ${pin} created`);
    return { pin, hostToken: room.hostToken };
  }

  private roomInfo(room: Room): RoomInfo {
    return { pin: room.pin, open: room.open, appName: room.bundle?.appName ?? null, players: room.players.size };
  }

  // ==========================================================================
  // WebSocket
  // ==========================================================================

  open(conn: RelayConnection): void {
    this.conns.set(conn, { role: 'none', room: null, playerId: null, limiter: new RateLimiter(RELAY_LIMITS.playerFramesPerSecond, RELAY_LIMITS.playerFrameBurst, this.now) });
  }

  close(conn: RelayConnection): void {
    const state = this.conns.get(conn);
    this.conns.delete(conn);
    if (!state?.room) return;
    const room = state.room;
    if (state.role === 'host' && room.host === conn) {
      room.host = null;
      room.hostAwaySince = this.now();
      this.toPlayers(room, { t: 'host-presence', connected: false });
    } else if (state.role === 'player' && state.playerId) {
      const player = room.players.get(state.playerId);
      if (player && player.conn === conn) {
        player.conn = null;
        this.toHost(room, { t: 'presence', player: this.publicPlayer(player), event: 'disconnect' });
      }
    }
  }

  message(conn: RelayConnection, text: string): void {
    const state = this.conns.get(conn);
    if (!state) return;
    if (!state.limiter.tryTake()) {
      this.send(conn, { t: 'error', code: 'RATE_LIMITED', message: 'Too many messages.', fatal: false });
      return;
    }
    let msg: RelayClientMessage;
    try {
      msg = JSON.parse(text) as RelayClientMessage;
    } catch {
      this.fail(conn, 'BAD_MESSAGE', 'Invalid JSON.', false);
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof msg.t !== 'string') {
      this.fail(conn, 'BAD_MESSAGE', 'Expected an object with "t".', false);
      return;
    }

    switch (msg.t) {
      case 'ping':
        this.send(conn, { t: 'pong', time: this.now() });
        return;
      case 'host':
        this.attachHost(conn, state, msg);
        return;
      case 'join':
        this.attachPlayer(conn, state, msg);
        return;
    }

    const room = state.room;
    if (!room) {
      this.fail(conn, 'NOT_ALLOWED', 'Send "host" or "join" first.', false);
      return;
    }

    if (state.role === 'host') {
      switch (msg.t) {
        case 'to': {
          const player = typeof msg.to === 'string' ? room.players.get(msg.to) : undefined;
          if (player?.conn) this.send(player.conn, { t: 'data', data: msg.data });
          return;
        }
        case 'open':
          room.open = msg.open === true;
          return;
        case 'kick': {
          const player = room.players.get(String(msg.playerId));
          if (!player) return;
          room.players.delete(player.id);
          room.kickedTokens.add(player.token);
          if (player.conn) {
            this.send(player.conn, { t: 'closed', reason: 'kicked' });
            this.conns.delete(player.conn);
            player.conn.close(CLOSE_NORMAL, 'kicked');
          }
          this.toHost(room, { t: 'presence', player: { ...this.publicPlayer(player), connected: false }, event: 'leave' });
          return;
        }
        case 'close':
          this.closeRoom(room, 'host');
          return;
      }
    } else if (state.role === 'player' && state.playerId) {
      const player = room.players.get(state.playerId);
      if (!player) return;
      switch (msg.t) {
        case 'up':
          this.toHost(room, { t: 'from', from: player.id, data: msg.data });
          return;
        case 'rename': {
          const name = normalizePlayerName(msg.name);
          if (!name) return;
          player.name = name;
          this.toHost(room, { t: 'presence', player: this.publicPlayer(player), event: 'rename' });
          return;
        }
      }
    }
    this.fail(conn, 'NOT_ALLOWED', `"${msg.t}" is not allowed here.`, false);
  }

  private attachHost(conn: RelayConnection, state: ConnState, msg: Extract<RelayClientMessage, { t: 'host' }>): void {
    if (msg.protocol !== RELAY_PROTOCOL) return this.fail(conn, 'UNSUPPORTED_PROTOCOL', `This server speaks relay protocol ${RELAY_PROTOCOL}.`, true);
    const room = isPin(msg.pin) ? this.rooms.get(msg.pin) : undefined;
    if (!room) return this.fail(conn, 'ROOM_NOT_FOUND', 'The room does not exist (anymore).', true);
    if (msg.hostToken !== room.hostToken) return this.fail(conn, 'NOT_ALLOWED', 'Wrong host token.', true);
    if (state.room) return this.fail(conn, 'NOT_ALLOWED', 'This connection is already attached.', false);
    if (room.host && room.host !== conn) {
      const old = room.host;
      this.conns.delete(old);
      old.close(CLOSE_POLICY, 'replaced by a new host connection');
    }
    state.role = 'host';
    state.room = room;
    state.limiter = new RateLimiter(RELAY_LIMITS.hostFramesPerSecond, RELAY_LIMITS.hostFrameBurst, this.now);
    room.host = conn;
    room.hostAwaySince = null;
    this.send(conn, { t: 'hosting', pin: room.pin, players: [...room.players.values()].map((p) => this.publicPlayer(p)) });
    this.toPlayers(room, { t: 'host-presence', connected: true });
  }

  private attachPlayer(conn: RelayConnection, state: ConnState, msg: Extract<RelayClientMessage, { t: 'join' }>): void {
    if (msg.protocol !== RELAY_PROTOCOL) return this.fail(conn, 'UNSUPPORTED_PROTOCOL', `This server speaks relay protocol ${RELAY_PROTOCOL}.`, true);
    const room = isPin(msg.pin) ? this.rooms.get(msg.pin) : undefined;
    if (!room) return this.fail(conn, 'ROOM_NOT_FOUND', 'No game with this PIN.', true);
    if (state.room) return this.fail(conn, 'NOT_ALLOWED', 'This connection is already attached.', false);
    if (typeof msg.token === 'string' && room.kickedTokens.has(msg.token)) return this.fail(conn, 'KICKED', 'You were removed from this game.', true);

    let player = typeof msg.token === 'string' ? [...room.players.values()].find((p) => p.token === msg.token) : undefined;
    let event: 'join' | 'connect' = 'connect';
    if (player) {
      if (player.conn && player.conn !== conn) {
        const old = player.conn;
        this.conns.delete(old);
        old.close(CLOSE_POLICY, 'replaced by a new connection');
      }
    } else {
      if (!room.open) return this.fail(conn, 'ROOM_CLOSED', 'The game is not accepting new players.', true);
      if (room.players.size >= RELAY_LIMITS.playersPerRoom) return this.fail(conn, 'ROOM_FULL', 'The game is full.', true);
      let id: string;
      do id = `p-${randomId(6)}`;
      while (room.players.has(id));
      player = { id, name: normalizePlayerName(msg.name) || 'Player', token: randomId(24), conn: null };
      room.players.set(id, player);
      event = 'join';
    }
    player.conn = conn;
    state.role = 'player';
    state.room = room;
    state.playerId = player.id;
    this.send(conn, { t: 'joined', pin: room.pin, playerId: player.id, token: player.token, name: player.name, hostConnected: room.host !== null });
    this.toHost(room, { t: 'presence', player: this.publicPlayer(player), event });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private publicPlayer(player: Player): RelayPlayer {
    return { id: player.id, name: player.name, connected: player.conn !== null };
  }

  private send(conn: RelayConnection, msg: RelayServerMessage): void {
    try {
      conn.send(JSON.stringify(msg));
    } catch {
      /* the socket is closing */
    }
  }

  private fail(conn: RelayConnection, code: RelayErrorCode, message: string, fatal: boolean): void {
    this.send(conn, { t: 'error', code, message, fatal });
    if (fatal) {
      this.conns.delete(conn);
      conn.close(CLOSE_POLICY, code);
    }
  }

  private toHost(room: Room, msg: RelayServerMessage): void {
    if (room.host) this.send(room.host, msg);
  }

  private toPlayers(room: Room, msg: RelayServerMessage): void {
    const text = JSON.stringify(msg);
    for (const player of room.players.values()) {
      try {
        player.conn?.send(text);
      } catch {
        /* closing */
      }
    }
  }

  private closeRoom(room: Room, reason: 'host' | 'expired'): void {
    this.rooms.delete(room.pin);
    const closed = JSON.stringify({ t: 'closed', reason } satisfies RelayServerMessage);
    const conns = [room.host, ...[...room.players.values()].map((p) => p.conn)].filter((c): c is RelayConnection => c !== null);
    for (const conn of conns) {
      try {
        conn.send(closed);
      } catch {
        /* closing */
      }
      this.conns.delete(conn);
      conn.close(CLOSE_NORMAL, 'room closed');
    }
    this.log(`room ${room.pin} closed (${reason})`);
  }

  /** Closes expired rooms; call periodically. */
  sweep(): void {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      const hostAway = room.hostAwaySince !== null && now - room.hostAwaySince > RELAY_LIMITS.hostAwayMs;
      if (hostAway || now - room.createdAt > RELAY_LIMITS.roomTtlMs) this.closeRoom(room, 'expired');
    }
    const hourAgo = now - 3_600_000;
    for (const [ip, times] of this.roomsByIp) {
      const recent = times.filter((t) => t > hourAgo);
      if (recent.length) this.roomsByIp.set(ip, recent);
      else this.roomsByIp.delete(ip);
    }
  }
}
