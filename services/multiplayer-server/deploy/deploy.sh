#!/usr/bin/env bash
# Builds the relay and deploys it to the server (ssh host alias, default memizy-vps).
# Usage (repository root): bash services/multiplayer-server/deploy/deploy.sh [host]
set -euo pipefail
HOST="${1:-memizy-vps}"
DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$DIR/../../.."

echo "› building packages"
(cd "$ROOT" && bun run --filter "@memizy/oqse" build >/dev/null && bun run --filter "@memizy/protocol" build >/dev/null)
echo "› bundling the relay"
mkdir -p "$DIR/relay/dist"
bun build "$DIR/../src/main.ts" --target=bun --minify --outfile="$DIR/relay/dist/server.js" >/dev/null

echo "› uploading to $HOST:/opt/memizy"
ssh "$HOST" 'mkdir -p /opt/memizy/relay/dist'
scp -q "$DIR/docker-compose.yml" "$HOST:/opt/memizy/docker-compose.yml"
scp -q "$DIR/relay/Dockerfile" "$HOST:/opt/memizy/relay/Dockerfile"
scp -q "$DIR/relay/dist/server.js" "$HOST:/opt/memizy/relay/dist/server.js"

echo "› starting"
ssh "$HOST" 'cd /opt/memizy && sudo docker compose up -d --build --remove-orphans && sudo docker compose ps'
