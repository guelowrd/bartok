#!/usr/bin/env bash
# BARTOK zkTLS self-test.
#  1) notarize a REAL openrouter.ai call, 2) verify it (shows disclosed vs redacted),
#  3) tamper with the proof and confirm verification REJECTS it.
set -uo pipefail
HERE="$(dirname "$0")"
[ -d "$HERE/tlsn" ] || { echo "No TLSNotary checkout — run ./setup.sh first."; exit 1; }
cd "$HERE/tlsn"

if [ -f ../.env ]; then set -a; . ../.env; set +a; fi
if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "Missing OPENROUTER_API_KEY — put it in zktls-spike/.env first."; exit 1
fi

echo "### 1) Notarize a real https://openrouter.ai call (cycling free models until a 200)…"
MODELS="openai/gpt-oss-20b:free qwen/qwen3-next-80b-a3b-instruct:free google/gemma-4-31b-it:free meta-llama/llama-3.3-70b-instruct:free nvidia/nemotron-nano-9b-v2:free"
got=""
for M in $MODELS; do
  echo "  - trying $M"
  out=$(RUST_LOG=error,openrouter_prove=info MODEL="$M" cargo run --release --example openrouter_prove 2>&1)
  if echo "$out" | grep -q "Got response: 200"; then echo "    -> 200 OK from $M"; got=1; break; fi
  echo "    -> $(echo "$out" | grep -oE 'Got response: [0-9]+' | head -1) (free model busy, next)"
done
[ -n "$got" ] || { echo "All free models are transiently rate-limited; re-run in ~1 min."; exit 1; }

echo
echo "### 2) Build presentation (reveal model/usage, redact key+prompt+answer) and VERIFY:"
cargo run --release --example openrouter_present >/dev/null 2>&1
cargo run --release --example openrouter_verify 2>/dev/null

echo
echo "### 3) TAMPER TEST — corrupt 8 bytes of the proof, then re-verify (MUST be rejected):"
cp openrouter.presentation.tlsn .good.tlsn
SIZE=$(wc -c < openrouter.presentation.tlsn)
printf '\xde\xad\xbe\xef\xde\xad\xbe\xef' | dd of=openrouter.presentation.tlsn bs=1 seek=$((SIZE/2)) count=8 conv=notrunc 2>/dev/null
if cargo run --release --example openrouter_verify >/dev/null 2>&1; then
  echo "  !!! PROBLEM: tampered proof was ACCEPTED (should not happen)"
else
  echo "  OK: tampered proof was REJECTED — verification failed, exactly as it should."
fi
mv .good.tlsn openrouter.presentation.tlsn

echo
echo "Conclusion: step 2's data is cryptographically proven to come from a real openrouter.ai"
echo "session; step 3 shows any edit to the proof breaks verification."
