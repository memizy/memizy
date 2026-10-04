import { describe, expect, it } from 'bun:test';
import { RELAY_LIMITS, RELAY_PROTOCOL, type RelayServerMessage } from '@memizy/protocol';
import { RelayServer, type RelayConnection } from './relay';

class FakeConn implements RelayConnection {
  readonly ip = '10.0.0.1';
  readonly received: RelayServerMessage[] = [];
  closed: { code: number; reason: string } | null = null;
  send(text: string): void {
    this.received.push(JSON.parse(text));
  }
  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }
  last<T extends RelayServerMessage['t']>(t: T): Extract<RelayServerMessage, { t: T }> | undefined {
    return this.received.filter((m) => m.t === t).at(-1) as Extract<RelayServerMessage, { t: T }> | undefined;
  }
}

function setup(now = { t: 0 }) {
  const relay = new RelayServer({ allowedOrigins: ['https://memizy.com'], now: () => now.t });
  const { pin, hostToken } = relay.createRoom();
  const connect = () => {
    const conn = new FakeConn();
    relay.open(conn);
    return conn;
  };
  const host = connect();
  relay.message(host, JSON.stringify({ t: 'host', protocol: RELAY_PROTOCOL, pin, hostToken }));
  const join = (name: string, token?: string) => {
    const conn = connect();
    relay.message(conn, JSON.stringify({ t: 'join', protocol: RELAY_PROTOCOL, pin, name, token }));
    return conn;
  };
  return { relay, pin, hostToken, host, connect, join, now };
}

describe('relay rooms', () => {
  it('attaches the host and players and forwards messages both ways', () => {
    const { relay, host, join } = setup();
    expect(host.last('hosting')?.players).toEqual([]);
    const anna = join('  Anna   Nováková ');
    const joined = anna.last('joined')!;
    expect(joined.name).toBe('Anna Nováková');
    expect(joined.hostConnected).toBe(true);
    expect(host.last('presence')).toEqual({ t: 'presence', event: 'join', player: { id: joined.playerId, name: 'Anna Nováková', connected: true } });

    relay.message(anna, JSON.stringify({ t: 'up', data: { hello: 1 } }));
    expect(host.last('from')).toEqual({ t: 'from', from: joined.playerId, data: { hello: 1 } });
    relay.message(host, JSON.stringify({ t: 'to', to: joined.playerId, data: [1, 2] }));
    expect(anna.last('data')).toEqual({ t: 'data', data: [1, 2] });
  });

  it('lets a player rejoin with the token as the same player', () => {
    const { relay, host, join } = setup();
    const first = join('Ben');
    const { playerId, token } = first.last('joined')!;
    relay.close(first);
    expect(host.last('presence')?.event).toBe('disconnect');
    const again = join('ignored', token);
    expect(again.last('joined')?.playerId).toBe(playerId);
    expect(again.last('joined')?.name).toBe('Ben');
    expect(host.last('presence')?.event).toBe('connect');
    expect(relay.stats.players).toBe(1);
  });

  it('replaces an older connection of the same player', () => {
    const { join } = setup();
    const first = join('Ben');
    const second = join('Ben', first.last('joined')!.token);
    expect(first.closed?.code).toBe(4000);
    expect(second.last('joined')).toBeDefined();
  });

  it('rejects unknown rooms, wrong host tokens and closed rooms', () => {
    const { relay, pin, connect, join, host } = setup();
    const lost = connect();
    relay.message(lost, JSON.stringify({ t: 'join', protocol: RELAY_PROTOCOL, pin: '000000', name: 'X' }));
    expect(lost.last('error')?.code).toBe('ROOM_NOT_FOUND');
    expect(lost.closed).not.toBeNull();

    const fake = connect();
    relay.message(fake, JSON.stringify({ t: 'host', protocol: RELAY_PROTOCOL, pin, hostToken: 'nope' }));
    expect(fake.last('error')?.code).toBe('NOT_ALLOWED');

    const early = join('Early');
    relay.message(host, JSON.stringify({ t: 'open', open: false }));
    const late = join('Late');
    expect(late.last('error')?.code).toBe('ROOM_CLOSED');
    // Players already in the room can still come back.
    relay.close(early);
    expect(join('x', early.last('joined')!.token).last('joined')).toBeDefined();
  });

  it('kicks players for good', () => {
    const { relay, host, join } = setup();
    const ben = join('Ben');
    const { playerId, token } = ben.last('joined')!;
    relay.message(host, JSON.stringify({ t: 'kick', playerId }));
    expect(ben.last('closed')?.reason).toBe('kicked');
    expect(host.last('presence')?.event).toBe('leave');
    expect(join('Ben', token).last('error')?.code).toBe('KICKED');
  });

  it('does not let players act as the host', () => {
    const { relay, join } = setup();
    const ben = join('Ben');
    relay.message(ben, JSON.stringify({ t: 'to', to: 'x', data: 1 }));
    expect(ben.last('error')?.code).toBe('NOT_ALLOWED');
    relay.message(ben, JSON.stringify({ t: 'close' }));
    expect(ben.last('closed')).toBeUndefined();
  });

  it('rate limits players', () => {
    const { relay, join } = setup();
    const ben = join('Ben');
    for (let i = 0; i < RELAY_LIMITS.playerFrameBurst + 5; i++) relay.message(ben, JSON.stringify({ t: 'up', data: i }));
    expect(ben.last('error')?.code).toBe('RATE_LIMITED');
  });

  it('closes the room on request and when the host stays away', () => {
    const { relay, host, join, now } = setup();
    const ben = join('Ben');
    relay.close(host);
    expect(ben.last('host-presence')?.connected).toBe(false);
    now.t += RELAY_LIMITS.hostAwayMs + 1;
    relay.sweep();
    expect(ben.last('closed')?.reason).toBe('expired');
    expect(relay.stats.rooms).toBe(0);

    const other = setup();
    const eva = other.join('Eva');
    other.relay.message(other.host, JSON.stringify({ t: 'close' }));
    expect(eva.last('closed')?.reason).toBe('host');
  });
});

describe('relay HTTP API', () => {
  const origin = 'https://memizy.com';
  const req = (path: string, init: RequestInit = {}) => new Request(`http://relay${path}`, { ...init, headers: { Origin: origin, ...init.headers } });

  it('creates rooms, stores and serves the bundle', async () => {
    const relay = new RelayServer({ allowedOrigins: [origin] });
    const created = await relay.handleHttp(req('/api/rooms', { method: 'POST' }), 'ip');
    expect(created?.status).toBe(201);
    expect(created?.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    const { pin, hostToken } = await created!.json();

    expect((await relay.handleHttp(req(`/api/rooms/${pin}/bundle`), 'ip'))?.status).toBe(404);
    const html = '<script type="application/oqse-manifest+json">{"appName":"Quiz"}</script>';
    const body = JSON.stringify({ pluginHtml: html, set: { meta: {}, items: [] } });
    expect((await relay.handleHttp(req(`/api/rooms/${pin}/bundle`, { method: 'PUT', body }), 'ip'))?.status).toBe(403);
    const put = await relay.handleHttp(req(`/api/rooms/${pin}/bundle`, { method: 'PUT', body, headers: { Authorization: `Bearer ${hostToken}` } }), 'ip');
    expect(await put!.json()).toEqual({ version: 1 });

    const got = await relay.handleHttp(req(`/api/rooms/${pin}/bundle`), 'ip');
    expect(got?.headers.get('X-Bundle-Version')).toBe('1');
    expect(await got!.json()).toEqual(JSON.parse(body));
    const info = await (await relay.handleHttp(req(`/api/rooms/${pin}`), 'ip'))!.json();
    expect(info).toEqual({ pin, open: true, appName: 'Quiz', players: 0 });
  });

  it('refuses foreign origins and too many rooms', async () => {
    const relay = new RelayServer({ allowedOrigins: [origin], roomsPerIpPerHour: 2 });
    const foreign = await relay.handleHttp(new Request('http://relay/api/rooms', { method: 'POST', headers: { Origin: 'https://evil.example' } }), 'ip');
    expect(foreign?.status).toBe(403);
    await relay.handleHttp(req('/api/rooms', { method: 'POST' }), 'ip');
    await relay.handleHttp(req('/api/rooms', { method: 'POST' }), 'ip');
    expect((await relay.handleHttp(req('/api/rooms', { method: 'POST' }), 'ip'))?.status).toBe(429);
    expect((await relay.handleHttp(req('/api/rooms', { method: 'POST' }), 'other-ip'))?.status).toBe(201);
    expect(await relay.handleHttp(req('/other'), 'ip')).toBeNull();
  });
});
