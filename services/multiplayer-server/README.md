# Memizy multiplayer server

A room relay between the host app and the player apps (Bun, no dependencies
besides `@memizy/protocol`). The game session runs in the host's browser
(`@memizy/host-sdk`, `RelayHost`); the server only manages rooms, PINs,
player identity and forwarding. Wire protocol: `packages/protocol/src/relay.ts`.

## Compatibility

Two layers travel over the relay, each with its own version:

* **Client ↔ server** (`RELAY_PROTOCOL`, now 1, in `join` / `host`). Within version 1
  messages only change additively; receivers ignore unknown fields. The server answers
  an unknown `t` with a non-fatal `NOT_ALLOWED` error, so a client checks what a
  server supports before relying on a new message.
* **Host app ↔ player app** (inside `data`; `RELAY_APP_VERSION` in `@memizy/host-sdk`,
  sent in the player's `hello` and the host's `mount`; an app that sends none is 0).
  Additive only; unknown `k` and fields are ignored, an unknown method is answered with
  `[UNKNOWN_METHOD]`. A host can see a cached older player app with
  `RelayHost.appVersionOf(playerId)` (e.g. version 0 cannot choose its place in a
  continued game, so the host assigns it).

**`auth`.** A player may join with `auth` (a string up to 4096 characters, e.g. a signed
token of a signed-in student). The server does not check it and passes it **only to the
host** (`RelayPlayer.auth` in `hosting` and `presence`), never to other players; a rejoin
with `auth` replaces it. Checking it is the host app's job.

## Development

```sh
bun run dev:server   # from the repository root: port 8787, any origin
```

A host app in development can connect to `http(s)://<same host>:8787`, so phones
in the same network join through the computer's LAN address.

## Configuration

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `PORT` | `8787` | HTTP/WebSocket port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` behind a reverse proxy) |
| `ALLOWED_ORIGINS` | `http://localhost:5180,http://127.0.0.1:5180` | Comma-separated origins of the apps; `*` = any (development only) |
| `TRUST_PROXY` | – | `1`: take the client IP from `CF-Connecting-IP` / `X-Forwarded-For` (behind a proxy) |
| `ROOMS_PER_IP_PER_HOUR` | `1000` | Rooms one IP may create per hour (a whole school shares one IP) |

## Deployment (Netcup, Docker, Cloudflare Tunnel)

Production runs in Docker on the server (`deploy/docker-compose.yml`): the relay
and `cloudflared`. **No port is open to the internet**: cloudflared connects out
to Cloudflare, which terminates TLS for `mp.memizy.com` and forwards to
`http://relay:8787`. SSH to the server only through Tailscale.

One-time setup:
1. Docker from the official repository (`docker-ce`, `docker-compose-plugin`).
2. Cloudflare Zero Trust → Networks → Tunnels → create a Cloudflared tunnel;
   public hostname `mp.memizy.com` → `HTTP` `relay:8787`.
3. On the server: `/opt/memizy/.env` with `TUNNEL_TOKEN=…` (`chmod 600`, never in git).

Deploy (from the repository root, ssh host alias `memizy-vps`):

```sh
bash services/multiplayer-server/deploy/deploy.sh
```

It bundles the relay into one file (`bun build`), uploads it with the compose
file and runs `docker compose up -d --build`. Check `https://mp.memizy.com/api/health`.

Logs: `ssh memizy-vps 'cd /opt/memizy && sudo docker compose logs -f relay'`.

The relay's `ALLOWED_ORIGINS` must list the origin of every host app that uses it
(Memizy Play runs at `https://memizy.com/play/`).

Rooms live in memory: a restart closes all running games (deploy outside lessons).
