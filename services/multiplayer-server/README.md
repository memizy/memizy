# Memizy multiplayer server

A room relay between the host app and the player apps (Bun, no dependencies
besides `@memizy/protocol`). The game session runs in the host's browser
(`@memizy/host-sdk`, `RelayHost`); the server only manages rooms, PINs,
player identity and forwarding. Wire protocol: `packages/protocol/src/relay.ts`.

## Development

```sh
bun run dev:server   # from the repository root: port 8787, any origin
bun run dev:play     # Memizy Play on http://localhost:5180/play/ (also on the LAN)
```

Memizy Play connects to `http(s)://<same host>:8787` by default, so phones in
the same network can join through the computer's LAN address. Set
`VITE_RELAY_URL` when building Play for production.

## Configuration

| Variable | Default | Meaning |
| :--- | :--- | :--- |
| `PORT` | `8787` | HTTP/WebSocket port |
| `HOST` | `0.0.0.0` | Bind address (`127.0.0.1` behind a reverse proxy) |
| `ALLOWED_ORIGINS` | `http://localhost:5180,http://127.0.0.1:5180` | Comma-separated origins of the apps; `*` = any (development only) |
| `TRUST_PROXY` | – | `1`: take the client IP from `X-Forwarded-For` (behind Caddy) |

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

Memizy Play runs on Cloudflare Workers (static assets, `apps/play/wrangler.jsonc`),
built by Workers Builds from `main`:
root directory `apps/play`, build command
`cd ../.. && bun install && bun run build:packages && cd apps/play && bun run build`,
deploy command `npx wrangler deploy`, build variables `PLAY_BASE=/`,
`VITE_RELAY_URL=https://mp.memizy.com`; custom domain `play.memizy.com`
(later `PLAY_BASE=/play/` on memizy.com). The relay's `ALLOWED_ORIGINS` must
list the app's origin.

Rooms live in memory: a restart closes all running games (deploy outside lessons).
