#!/usr/bin/env bash
# Bootstraps the zkTLS spike: clones TLSNotary at a pinned tag and wires in our
# OpenRouter example (sources live in ./openrouter-example, not vendored into git).
set -euo pipefail
cd "$(dirname "$0")"
TAG=v0.1.0-alpha.15
REPO=https://github.com/tlsnotary/tlsn.git

if [ ! -d tlsn ]; then
  echo "Cloning tlsn @ $TAG (shallow)…"
  git clone --depth 1 --branch "$TAG" "$REPO"
fi

DST=tlsn/crates/examples/openrouter
mkdir -p "$DST"
cp openrouter-example/prove.rs openrouter-example/present.rs openrouter-example/verify.rs openrouter-example/oracle.rs "$DST"/

CARGO=tlsn/crates/examples/Cargo.toml
# add the real-web-PKI roots dep (idempotent)
grep -q 'webpki-root-certs' "$CARGO" || \
  perl -0pi -e 's/\[dependencies\]\n/[dependencies]\nwebpki-root-certs = { workspace = true }\n/' "$CARGO"
# register the example targets (idempotent)
grep -q 'openrouter_prove' "$CARGO" || cat >> "$CARGO" <<'EOF'

[[example]]
name = "openrouter_prove"
path = "openrouter/prove.rs"

[[example]]
name = "openrouter_present"
path = "openrouter/present.rs"

[[example]]
name = "openrouter_verify"
path = "openrouter/verify.rs"

[[example]]
name = "openrouter_oracle"
path = "openrouter/oracle.rs"
EOF

echo "Done. Next:"
echo "  cp .env.example .env   # add a free OpenRouter key (https://openrouter.ai/keys)"
echo "  ./test-zktls.sh"
