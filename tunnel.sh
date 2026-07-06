#!/usr/bin/env bash
# Stable public URL for the backend via ngrok's free static domain.
# URL survives reboots → the Vercel env var never needs updating again.
#
# One-time setup:
#   1. brew install ngrok                      (done)
#   2. sign up at ngrok.com (free) → dashboard → Your Authtoken →
#        ngrok config add-authtoken <token>
#   3. dashboard → Domains → copy your free static domain, then:
#        echo "<your-name>.ngrok-free.app" > guardian/.tunnel-domain
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
command -v ngrok >/dev/null 2>&1 || { echo "ngrok missing:  brew install ngrok"; exit 1; }
ngrok config check >/dev/null 2>&1 || { echo "no authtoken yet:  ngrok config add-authtoken <token>  (ngrok.com dashboard)"; exit 1; }
curl -s --max-time 2 http://localhost:8787/api/config >/dev/null 2>&1 || { echo "bridge not up — run ./serve.sh first"; exit 1; }
DOMAIN_FILE="$DIR/guardian/.tunnel-domain"
[ -s "$DOMAIN_FILE" ] || { echo "no static domain configured:"; echo "  echo \"<your-name>.ngrok-free.app\" > guardian/.tunnel-domain"; echo "  (claim it free: ngrok dashboard → Domains)"; exit 1; }
DOMAIN="$(tr -d '[:space:]' < "$DOMAIN_FILE")"
# take over: ngrok free tier allows ONE agent session — stop any previous one
pkill -f "ngrok http" 2>/dev/null && sleep 1 || true
echo "backend public URL: https://$DOMAIN"
exec ngrok http --domain="$DOMAIN" 8787
