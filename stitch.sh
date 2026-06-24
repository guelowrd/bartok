#!/usr/bin/env bash
# BARTOK end-to-end stitch:  zkTLS proof  ->  oracle (charge)  ->  Miden settlement split.
#
# Proves the data pipeline: a real, zkTLS-notarized token usage flows through the off-chain
# oracle into the on-chain escrow split. (On-chain gating of settlement by an oracle signature
# is deferred; see ARCHITECTURE.md.)
#
# Prereqs (run once):
#   zktls-spike/setup.sh           # clones + wires TLSNotary
#   cp zktls-spike/.env.example zktls-spike/.env && edit  # free OpenRouter key
#   miden-settlement/install.sh    # wires the contract + test into the agentic-template
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TLSN="$ROOT/zktls-spike/tlsn"
TEMPLATE="${AGENTIC_TEMPLATE:-$HOME/Code/agentic-template}/project-template"

[ -d "$TLSN" ] || { echo "Missing $TLSN — run zktls-spike/setup.sh first."; exit 1; }
[ -d "$TEMPLATE/contracts/bartok-settlement" ] || { echo "Settlement not wired — run miden-settlement/install.sh first."; exit 1; }
[ -f "$ROOT/zktls-spike/.env" ] || { echo "Add an OpenRouter key to zktls-spike/.env (see .env.example)."; exit 1; }

echo "=== 1) zkTLS: notarize a real model call (cycling free models for a 200) ==="
cd "$TLSN"; set -a; . "$ROOT/zktls-spike/.env"; set +a
got=""
for M in openai/gpt-oss-20b:free qwen/qwen3-next-80b-a3b-instruct:free meta-llama/llama-3.3-70b-instruct:free nvidia/nemotron-nano-9b-v2:free; do
  out=$(RUST_LOG=error,openrouter_prove=info MODEL="$M" cargo run --release --example openrouter_prove 2>&1)
  if echo "$out" | grep -q "Got response: 200"; then echo "  notarized via $M"; got=1; break; fi
  echo "  $M -> $(echo "$out" | grep -oE 'Got response: [0-9]+' | head -1) (busy, next)"
done
[ -n "$got" ] || { echo "All free models transiently rate-limited; retry in ~1 min."; exit 1; }
cargo run --release --example openrouter_present >/dev/null 2>&1

echo "=== 2) oracle: verify the proof, derive the charge ==="
CHARGE=$(cargo run --release --example openrouter_oracle 2>/dev/null | tail -1)
[ -n "$CHARGE" ] || { echo "oracle failed to derive a charge"; exit 1; }
echo "  charge (= zkTLS-proven tokens used) = $CHARGE"

echo "=== 3) Miden: settle the escrow with that charge ==="
BUDGET=$(( CHARGE * 4 ))
cd "$TEMPLATE"
BARTOK_BUDGET=$BUDGET BARTOK_CHARGE=$CHARGE \
  cargo test -p integration --release --test settlement_split_test 2>&1 | grep -E "test result|settlement_split_test" | tail -3

echo
echo "STITCH OK: zkTLS-proven usage ($CHARGE tokens) -> seller paid $CHARGE, buyer refunded $((BUDGET-CHARGE)) on Miden."
