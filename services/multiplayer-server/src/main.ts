/**
 * Memizy multiplayer server (relay) on Bun.
 *
 * Environment:
 * - PORT (default 8787), HOST (default 0.0.0.0)
 * - ALLOWED_ORIGINS: comma-separated origins, e.g. "https://memizy.com,http://localhost:5180";
 *   "*" allows any origin (development only). Default: the local dev servers.
 * - TRUST_PROXY=1: take the client IP from X-Forwarded-For (behind Caddy).
 */

import { RELAY_LIMITS } from '@memizy/protocol';
import { RelayServer, type RelayConnection } from './relay';

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? '0.0.0.0';
const origins = process.env.ALLOWED_ORIGINS ?? 'http://localhost:5180,http://127.0.0.1:5180';
const allowedOrigins = origins.trim() === '*' ? '*' : origins.split(',').map((o) => o.trim()).filter(Boolean);
const trustProxy = process.env.TRUST_PROXY === '1';

const relay = new RelayServer({ allowedOrigins, log: (m) => console.log(`[relay] ${m}`) });

interface SocketData {
  conn: RelayConnection | null;
  ip: string;
}

function clientIp(request: Request, server: Bun.Server<SocketData>): string {
  if (trustProxy) {
    const forwarded = request.headers.get('X-Forwarded-For');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return server.requestIP(request)?.address ?? 'unknown';
}

const server = Bun.serve<SocketData>({
  port,
  hostname,
  async fetch(request, server) {
    const url = new URL(request.url);
    const ip = clientIp(request, server);
    if (url.pathname === '/ws') {
      if (!relay.isOriginAllowed(request.headers.get('Origin'))) return new Response('Origin not allowed', { status: 403 });
      if (server.upgrade(request, { data: { conn: null, ip } })) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }
    return (await relay.handleHttp(request, ip)) ?? new Response('Memizy multiplayer server', { status: 404 });
  },
  websocket: {
    maxPayloadLength: RELAY_LIMITS.frameBytes,
    idleTimeout: 60,
    sendPings: true,
    open(ws) {
      ws.data.conn = {
        ip: ws.data.ip,
        send: (text) => void ws.send(text),
        close: (code, reason) => ws.close(code, reason),
      };
      relay.open(ws.data.conn);
    },
    message(ws, message) {
      if (ws.data.conn) relay.message(ws.data.conn, typeof message === 'string' ? message : new TextDecoder().decode(message));
    },
    close(ws) {
      if (ws.data.conn) relay.close(ws.data.conn);
    },
  },
});

setInterval(() => relay.sweep(), 30_000);
console.log(`[relay] listening on http://${hostname}:${server.port} (origins: ${Array.isArray(allowedOrigins) ? allowedOrigins.join(', ') : '*'})`);
