#!/usr/bin/env bash
# Deploy BARTOK's backend to a fresh Ubuntu VPS. Run FROM the Mac:
#   scripts/deploy-vps.sh root@<server-ip>
#
# Rsyncs the two repos WITH runtime state (miden store/keystore/signers,
# guardian keys+data, notary keys, .env, users/refunds), plus the ngrok config
# (authtoken + static domain), then runs vps-bootstrap.sh on the server.
set -euo pipefail
HOST="${1:?usage: deploy-vps.sh root@<ip>}"
BARTOK="$(cd "$(dirname "$0")/.." && pwd)"
GUARDIAN="$BARTOK/../bartok-guardian"

echo "=== rsync bartok repo (+state, -build junk) → $HOST:/opt/bartok ==="
# --exclude target: ALL Rust build dirs are rebuildable (miden/target 5.8G,
# miden/contracts/*/target 3.7G, tlsn/target ~950M). --partial/--timeout survive
# a dropped connection mid-transfer instead of failing the whole deploy.
rsync -az --delete --partial --timeout=300 \
  --exclude 'target' --exclude 'node_modules' --exclude '.vite' \
  --exclude 'ux-prototype/dist' --exclude '.git' \
  "$BARTOK/" "$HOST:/opt/bartok/"

echo "=== rsync bartok-guardian fork → $HOST:/opt/bartok-guardian ==="
rsync -az --delete --partial --timeout=300 \
  --exclude 'target' --exclude 'node_modules' --exclude '.git' \
  "$GUARDIAN/" "$HOST:/opt/bartok-guardian/"

echo "=== ngrok config (authtoken) ==="
NGROK_CFG="$HOME/Library/Application Support/ngrok/ngrok.yml"
ssh "$HOST" 'mkdir -p /root/.config/ngrok'
scp -q "$NGROK_CFG" "$HOST:/root/.config/ngrok/ngrok.yml"

echo "=== bootstrap on the server (builds ~15-25 min on first run) ==="
ssh "$HOST" 'bash /opt/bartok/scripts/vps-bootstrap.sh'

echo
echo "Deployed. The static ngrok domain now points at the server."
echo "Remember to STOP the local tunnel on the Mac (one agent per free account):"
echo "  pkill -f 'ngrok http'"
