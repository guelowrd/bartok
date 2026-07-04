#!/usr/bin/env bash
# Bring up BARTOK's local backend: Bartok-Guardian + the bridge. (Run the buyer
# UI separately with `cd ux-prototype && npm run dev`, or deploy it to Vercel.)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
echo "starting Bartok-Guardian…"
( "$DIR/guardian/run.sh" & )
sleep 4
echo "starting the bridge (:8787, proxies /guardian → :3300)…"
exec node "$DIR/ux-prototype/server.js"
