# BARTOK settlement (Miden)

The on-chain half of BARTOK: a Miden **note** that settles a job. The buyer escrows a budget in
the note; when it is consumed, the note pays the seller for what was used and refunds the buyer the
rest, as two **P2ID** output notes. Built on the Rust SDK (`miden = 0.12`, protocol 0.14) using the
[0xMiden/agentic-template](https://github.com/0xMiden/agentic-template) workspace.

## Files
- `contract/` — the `bartok-settlement` note crate (`#[note]` script). Reads its inputs via
  `active_note::get_storage()`, splits the escrowed asset, and emits two P2ID outputs.
- `tests/settlement_split_test.rs` — MockChain integration test (TDD).

## Status
- **Increment 1 — done, test green.** Escrow `budget` is split into seller `charge` + buyer
  `refund`; recipient digests and amounts are asserted in MockChain.
- **Increment 2 — pending.** Verify an RPO Falcon-512 oracle signature over the settlement
  commitment (`emit_falcon_sig_to_stack` + `rpo_falcon512_verify`) before paying out, so the split
  only happens when the off-chain oracle has attested the zkTLS proof. Plan is de-risked (see the
  repo root `ARCHITECTURE.md`).

## Run
```bash
# 1. Have an agentic-template checkout (default: ~/Code/agentic-template)
./install.sh [path-to-agentic-template]

# 2. Build + test (needs the protocol-0.14 toolchain; see below)
cd <agentic-template>/project-template
cargo miden build --manifest-path contracts/bartok-settlement/Cargo.toml --release
cargo test -p integration --release --test settlement_split_test
```

## Toolchain requirement (protocol 0.14 / midenc 0.8.1)
`miden = 0.12` needs protocol v0.14 (`active_note::get_storage`). If your active toolchain is older
(e.g. channel 0.13.3 / midenc 0.7.1) the build panics at MASM lowering with
`No Miden ABI function type found for ...active_note/get_storage`. Fix:
```bash
cargo install --git https://github.com/0xMiden/midenup midenup --force   # midenup that parses the new manifest
midenup install 0.14.0
cd <agentic-template>/project-template && midenup set 0.14.0
# repoint the cargo-miden shim at the 0.14.0 toolchain (it may be pinned to an old binary):
ln -sf "$HOME/Library/Application Support/midenup/toolchains/0.14.0/bin/cargo-miden" ~/.cargo/bin/cargo-miden
```

## Implementation notes
- Build the split assets by reconstructing from the consumed asset's own word
  (`Asset::new(escrow.key, [amount, val1, val2, val3])`), not `create_fungible_asset` (which
  u32-faults validating a reconstructed faucet id).
- Guard `budget - charge` with `as_canonical_u64()` (felt subtraction wraps the field).
- Pass the P2ID script root in via note storage (`P2idNote::script_root()` in the test) rather than
  hardcoding a version-specific digest.
