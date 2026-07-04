#!/usr/bin/env bash
# Expose the local bridge (:8787) as a stable HTTPS URL for real Rita testers.
# The bridge proxies /guardian → Bartok-Guardian, so ONE tunnel serves both.
#
#   1. brew install cloudflared   (once)
#   2. ./tunnel.sh                 → prints an https://….trycloudflare.com URL
#   3. Deploy the buyer UI to Vercel with VITE_BARTOK_BACKEND=<that url>
#      (cd ux-prototype && vercel deploy --prod)
set -euo pipefail
exec cloudflared tunnel --url http://localhost:8787
