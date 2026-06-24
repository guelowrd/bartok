#!/usr/bin/env bash
# Wires the BARTOK Miden settlement contract + MockChain test into an
# 0xMiden/agentic-template checkout (the contract crate + the integration test).
set -euo pipefail
cd "$(dirname "$0")"

TEMPLATE="${1:-$HOME/Code/agentic-template}"
PT="$TEMPLATE/project-template"
if [ ! -d "$PT" ]; then
  echo "agentic-template not found at: $TEMPLATE"
  echo "Clone it first:  git clone --recurse-submodules https://github.com/0xMiden/agentic-template.git"
  exit 1
fi

mkdir -p "$PT/contracts/bartok-settlement"
cp -R contract/Cargo.toml contract/src "$PT/contracts/bartok-settlement/"
cp tests/settlement_split_test.rs "$PT/integration/tests/"

echo "Wired into $PT"
echo
echo "Requires the protocol-0.14 toolchain (midenc 0.8.1). If 'cargo miden build' panics with"
echo "  'No Miden ABI function type found for ...active_note/get_storage', run the toolchain fix in README.md."
echo
echo "Then:"
echo "  cd $PT"
echo "  cargo miden build --manifest-path contracts/bartok-settlement/Cargo.toml --release"
echo "  cargo test -p integration --release --test settlement_split_test"
