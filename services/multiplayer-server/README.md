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

## Deployment (Netcup, Caddy, systemd)

1. Install Bun, clone the repository, run `bun install`.
2. systemd unit `/etc/systemd/system/memizy-relay.service`:

   ```ini
   [Unit]
   Description=Memizy multiplayer relay
   After=network.target

   [Service]
   WorkingDirectory=/opt/memizy/engine/services/multiplayer-server
   ExecStart=/usr/local/bin/bun src/main.ts
   Environment=PORT=8787 HOST=127.0.0.1 TRUST_PROXY=1
   Environment=ALLOWED_ORIGINS=https://memizy.com
   Restart=always
   User=memizy

   [Install]
   WantedBy=multi-user.target
   ```

3. Caddy (`/etc/caddy/Caddyfile`) for TLS and WebSockets:

   ```
   mp.memizy.com {
     encode gzip
     reverse_proxy 127.0.0.1:8787
   }
   ```

4. `systemctl enable --now memizy-relay && systemctl reload caddy`, then check
   `https://mp.memizy.com/api/health`.

On the app side (`memizy.com/play`): build with `VITE_RELAY_URL=https://mp.memizy.com`
and allow `https://mp.memizy.com wss://mp.memizy.com` in the CSP `connect-src`.

Rooms live in memory: a restart closes all running games (deploy outside lessons).
