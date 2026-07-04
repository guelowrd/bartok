#!/usr/bin/env bash
# NOTE: this is the CYCLE 1 E2E (public notes, plain settle_session). Cycle 2
# settlement now goes through Bartok-Guardian multisig proposals — use the Rita
# UI flow in DEMO.md for the current end-to-end. The --mock leg (MockChain
# regression) still works and is the fast contract check.
# BARTOK headless E2E: BOTH tiers through zkTLS -> oracle, assert the verified
# models differ and the genius charge uses the 7x price, then settle the summed
# charge on Miden TESTNET (buyer-side escrow via smoke_escrow + operator-side
# settle_session).
#
#   ./stitch.sh          full run (testnet; ~5-10 min incl. proving + blocks)
#   ./stitch.sh --mock   MockChain regression only (fast, offline)
#
# Prereqs (run once):
#   zktls-spike/setup.sh                                   # clones + wires TLSNotary
#   cp zktls-spike/.env.example zktls-spike/.env && edit   # free OpenRouter key
#   (cd zktls-spike/tlsn && cargo run --release --example openrouter_keygen)
#   (cd miden/integration && cargo run --release --bin setup_accounts)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
TLSN="$ROOT/zktls-spike/tlsn"
MIDEN="$ROOT/miden/integration"

if [ "${1:-}" = "--mock" ]; then
  echo "=== MockChain regression (settlement_split_test) ==="
  cd "$MIDEN" && exec cargo test -p integration --release --test settlement_split_test
fi

[ -d "$TLSN" ] || { echo "Missing $TLSN — run zktls-spike/setup.sh first."; exit 1; }
[ -f "$ROOT/zktls-spike/.env" ] || { echo "Add an OpenRouter key to zktls-spike/.env (see .env.example)."; exit 1; }
[ -f "$ROOT/keys/notary.pub.hex" ] || { echo "Generate notary keys: cd zktls-spike/tlsn && cargo run --release --example openrouter_keygen"; exit 1; }
[ -f "$ROOT/miden/accounts.json" ] || { echo "Run setup_accounts first: cd miden/integration && cargo run --release --bin setup_accounts"; exit 1; }

cd "$TLSN"; set -a; . "$ROOT/zktls-spike/.env"; set +a
export PROMPT="${PROMPT:-In two sentences, why do arrays start at zero?}"
export RUST_LOG=error,openrouter_prove=info

# tier definitions — keep in sync with ux-prototype/server.js TIERS
BASIC_MODELS="nvidia/nemotron-nano-9b-v2:free openai/gpt-oss-20b:free"
GENIUS_MODELS="meta-llama/llama-3.3-70b-instruct:free qwen/qwen3-next-80b-a3b-instruct:free openai/gpt-oss-120b:free nvidia/nemotron-3-super-120b-a12b:free"

# run_tier <models> <price> -> sets ORACLE_MODEL / ORACLE_TOKENS / ORACLE_CHARGE
run_tier() {
  local models="$1" price="$2" got=""
  for M in $models; do
    out=$(MODEL="$M" cargo run --release --example openrouter_prove 2>&1)
    if echo "$out" | grep -q "Got response: 200"; then got=1; break; fi
    echo "  $M -> $(echo "$out" | grep -oE 'Got response: [0-9]+' | head -1 || echo 'error') (busy, next)"
  done
  [ -n "$got" ] || { echo "tier's free models all rate-limited; retry shortly"; exit 1; }
  cargo run --release --example openrouter_present >/dev/null 2>&1 || { echo "present failed"; exit 1; }
  oracle_json=$(PRICE_PER_TOKEN="$price" cargo run --release --example openrouter_oracle 2>/dev/null | tail -1)
  ORACLE_MODEL=$(echo "$oracle_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['model'])")
  ORACLE_TOKENS=$(echo "$oracle_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['total_tokens'])")
  ORACLE_CHARGE=$(echo "$oracle_json" | python3 -c "import json,sys; print(json.load(sys.stdin)['charge'])")
}

echo "=== 1) BASIC tier: notarize + verify (price 1/token) ==="
run_tier "$BASIC_MODELS" 1
BASIC_MODEL="$ORACLE_MODEL"; BASIC_TOKENS="$ORACLE_TOKENS"; BASIC_CHARGE="$ORACLE_CHARGE"
echo "  verified: $BASIC_MODEL, $BASIC_TOKENS tokens -> $BASIC_CHARGE units"

echo "=== 2) GENIUS tier: same prompt, HQ model (price 7/token) ==="
run_tier "$GENIUS_MODELS" 7
GENIUS_MODEL="$ORACLE_MODEL"; GENIUS_TOKENS="$ORACLE_TOKENS"; GENIUS_CHARGE="$ORACLE_CHARGE"
echo "  verified: $GENIUS_MODEL, $GENIUS_TOKENS tokens -> $GENIUS_CHARGE units"

echo "=== 3) assertions ==="
[ "$BASIC_MODEL" != "$GENIUS_MODEL" ] || { echo "FAIL: both tiers proved the same model ($BASIC_MODEL)"; exit 1; }
[ "$GENIUS_CHARGE" -eq $((GENIUS_TOKENS * 7)) ] || { echo "FAIL: genius charge != tokens*7"; exit 1; }
[ "$BASIC_CHARGE" -eq "$BASIC_TOKENS" ] || { echo "FAIL: basic charge != tokens*1"; exit 1; }
echo "  models differ ✓  pricing correct ✓"

TOTAL=$((BASIC_CHARGE + GENIUS_CHARGE))
echo "=== 4) settle $TOTAL units on Miden testnet ==="
cd "$MIDEN"
escrow_out=$(cargo run --release -p integration --bin smoke_escrow 2>&1) || { echo "$escrow_out" | tail -5; exit 1; }
settle_cmd=$(echo "$escrow_out" | grep "settle_session" | sed "s/--charge <N>/--charge $TOTAL/")
[ -n "$settle_cmd" ] || { echo "smoke_escrow gave no settle command:"; echo "$escrow_out" | tail -5; exit 1; }
echo "  escrow: $(echo "$escrow_out" | grep 'escrow note:' | awk '{print $3}')"
settle_out=$(eval "$settle_cmd" 2>&1) || { echo "$settle_out" | tail -5; exit 1; }
echo "$settle_out" | tail -1 | python3 -c "
import json,sys
d=json.loads(sys.stdin.read().strip().split(chr(10))[-1])
print('  settled ✓  tx:', d['explorer'])
print('  seller got', d['charge'], 'units; buyer refunded', d['refund'])"

echo
echo "E2E OK: basic=$BASIC_MODEL genius=$GENIUS_MODEL total=$TOTAL units"
