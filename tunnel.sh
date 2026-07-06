#!/usr/bin/env bash
# Expose the local bridge (:8787) as a public HTTPS URL for real Rita testers.
# The bridge proxies /guardian → Bartok-Guardian, so ONE tunnel serves both.
# NOTE: each run of a quick tunnel mints a NEW URL → the Vercel env var
# VITE_BARTOK_BACKEND must be updated + redeployed when the URL changes.
set -euo pipefail
command -v cloudflared >/dev/null 2>&1 || {
  echo "cloudflared is not installed. Run:  brew install cloudflared"; exit 1; }
curl -s --max-time 2 http://localhost:8787/api/config >/dev/null 2>&1 || {
  echo "bridge is not up on :8787 — run ./serve.sh first"; exit 1; }
exec cloudflared tunnel --url http://localhost:8787
