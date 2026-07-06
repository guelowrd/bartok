#!/usr/bin/env bash
# Bring up BARTOK's local backend: Bartok-Guardian + the bridge.
# Idempotent: takes over the ports from any previous instances, then waits for
# Guardian to actually answer before starting the bridge (no blind sleeps).
# (Run the buyer UI separately: `cd ux-prototype && npm run dev`, or use Vercel.)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

# Take over: stop whatever holds our ports (stale runs, dev instances).
for port in 8787 3300 50052; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "stopping previous listener on :$port (pid $pids)"
    kill $pids 2>/dev/null || true
  fi
done
sleep 1

echo "starting Bartok-Guardian… (first run compiles Rust; can take a few minutes)"
"$DIR/guardian/run.sh" > "$DIR/guardian/guardian.log" 2>&1 &

printf "waiting for Guardian on :3300 "
ok=""
for _ in $(seq 1 150); do
  if curl -s --max-time 2 http://localhost:3300/pubkey >/dev/null 2>&1; then ok=1; break; fi
  printf "."; sleep 2
done
echo
if [ -z "$ok" ]; then
  echo "Guardian didn't come up after 5 min — see guardian/guardian.log"
  exit 1
fi
echo "Guardian up ✓  ($(curl -s http://localhost:3300/pubkey | head -c 60)…)"

echo "starting the bridge on :8787 (proxies /guardian → :3300)…"
exec node "$DIR/ux-prototype/server.js"
