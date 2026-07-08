#!/usr/bin/env bash
# Bartok-Guardian — BARTOK's application Guardian (a BARTOK backend service).
#
# Code lives in ~/Code/bartok-guardian (dedicated clone; ~/Code/guardian is
# Gaylord's upstream-tracking checkout and is never touched). State and ACK
# keys live HERE (gitignored). First run: ./run.sh keygen, then ./run.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SRC="${BARTOK_GUARDIAN_SRC:-$HOME/Code/bartok-guardian}"

[ -f "$DIR/.env" ] && { set -a; . "$DIR/.env"; set +a; }

export GUARDIAN_ACK_SECRET_PROVIDER="${GUARDIAN_ACK_SECRET_PROVIDER:-file}"
export GUARDIAN_ACK_FALCON_SECRET_PATH="${GUARDIAN_ACK_FALCON_SECRET_PATH:-$DIR/keys/ack-falcon.hex}"
export GUARDIAN_ACK_ECDSA_SECRET_PATH="${GUARDIAN_ACK_ECDSA_SECRET_PATH:-$DIR/keys/ack-ecdsa.hex}"
export GUARDIAN_STORAGE_PATH="${GUARDIAN_STORAGE_PATH:-$DIR/data/storage}"
export GUARDIAN_METADATA_PATH="${GUARDIAN_METADATA_PATH:-$DIR/data/metadata}"
export GUARDIAN_KEYSTORE_PATH="${GUARDIAN_KEYSTORE_PATH:-$DIR/data/keystore}"
export GUARDIAN_NETWORK_TYPE="${GUARDIAN_NETWORK_TYPE:-MidenTestnet}"
# Bartok-Guardian's own ports (3000/50051 are taken by other local services)
export GUARDIAN_HTTP_PORT="${GUARDIAN_HTTP_PORT:-3300}"
export GUARDIAN_GRPC_PORT="${GUARDIAN_GRPC_PORT:-50052}"

# Take over: a stale Guardian (e.g. from a previous serve.sh) must not block us.
for port in "$GUARDIAN_HTTP_PORT" "$GUARDIAN_GRPC_PORT"; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "stopping previous listener on :$port (pid $pids)"
    kill $pids 2>/dev/null || true
  fi
done
sleep 1

mkdir -p "$DIR/data" "$DIR/keys"

if [ "${1:-}" = "keygen" ]; then
  if [ -s "$GUARDIAN_ACK_FALCON_SECRET_PATH" ] || [ -s "$GUARDIAN_ACK_ECDSA_SECRET_PATH" ]; then
    echo "refusing to overwrite existing ACK keys in $DIR/keys — delete them to regenerate" >&2
    exit 1
  fi
  json="$(cd "$SRC" && cargo run --release -p guardian-server --bin ack-keygen 2>/dev/null | tail -1)"
  python3 - "$json" "$GUARDIAN_ACK_FALCON_SECRET_PATH" "$GUARDIAN_ACK_ECDSA_SECRET_PATH" <<'EOF'
import json, sys, os
keys = json.loads(sys.argv[1])
for val, path in ((keys["falcon_secret_key"], sys.argv[2]), (keys["ecdsa_secret_key"], sys.argv[3])):
    with open(path, "w") as f: f.write(val)
    os.chmod(path, 0o600)
    print(f"wrote {path} (0600)")
EOF
  exit 0
fi

for f in "$GUARDIAN_ACK_FALCON_SECRET_PATH" "$GUARDIAN_ACK_ECDSA_SECRET_PATH"; do
  [ -s "$f" ] || { echo "missing ACK key $f — run: $0 keygen" >&2; exit 1; }
done

cd "$SRC"
# Prefer the pre-built release binary: `cargo run` re-checks fingerprints and can
# trigger a full recompile on every restart (~7 min of downtime). The built binary
# starts instantly. Fall back to `cargo run` if it isn't built yet (dev/first run).
BIN="$SRC/target/release/server"
if [ -x "$BIN" ]; then exec "$BIN"; else exec cargo run --release -p guardian-server --bin server; fi
