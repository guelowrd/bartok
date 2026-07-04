# BARTOK — demo runbook (testnet MVP)

The "Uber of LLMs" on **Miden testnet**: a buyer holds a real in-browser Miden wallet,
locks a BART budget in an on-chain escrow (like a ride-hailing card hold), chats with
João whose two tiers are two real models, and every reply's **model identity and token
count are extracted from a zkTLS proof** of the provider TLS session. Ending the chat
settles once on testnet: João gets his charge, the buyer gets the rest back.

## What's real vs. staged

| Real | Staged (cosmetic) |
| --- | --- |
| Buyer wallet (in-browser Miden client, private account) | Helper matching animation |
| BART balance, escrow note, settlement tx, refund (all on testnet, midenscan-linkable) | Ratings / tags / feedback |
| The model reply (real OpenRouter call, notarized via TLSNotary MPC-TLS) | Seller "reputation" |
| Verified model + token count (extracted from the proof by the oracle, notary-key checked) | |
| Tier switch: Basic = 9B model @ 1 Ŧ/token, Genius = 70B+ class @ 7 Ŧ/token | |
| João's dashboard feed (SSE from the bridge, real jobs + real settlements) | |

Known deferred gap: the settlement note trusts the operator-supplied charge
(on-chain oracle gating is a later increment; see ARCHITECTURE.md).

## Prereqs (once)

```bash
zktls-spike/setup.sh                                  # clones + wires TLSNotary
cp zktls-spike/.env.example zktls-spike/.env          # then add a free OpenRouter key
(cd zktls-spike/tlsn && cargo run --release --example openrouter_keygen)   # notary keys
(cd miden/integration && cargo run --release --bin setup_accounts)         # João + operator + BART faucet on testnet
(cd ux-prototype && npm install && npm run build:contracts)                # UI deps + compiled note for the browser
```

Toolchain: rustup (stable + the pinned nightly auto-installs), `cargo install cargo-miden`
(0.9.x — the midenup 0.14-channel shim is too old and must not shadow it), Node 18+.

## Run

```bash
node ux-prototype/server.js        # the bridge; wait for:  [warm] ready ✓
cd ux-prototype && npm run dev     # buyer UI on http://localhost:5173
# seller dashboard: http://localhost:8787/seller.html
```

## The demo (side-by-side windows)

1. Buyer header shows the wallet's real BART balance. If low, **Get BART** mints
   50,000 from the project faucet (~15 s, midenscan link in the toast).
2. **Find a helper**: locks 25,000 Ŧ in the escrow note. The browser builds and
   proves the tx via the remote testnet prover behind the matching animation (~1-2 min).
3. Ask something on **Basic**: ~15 s, reply lands with `✓ verified`, the model chip
   (nemotron-nano-9b) and the per-token price. João's dashboard shows the job live.
4. **The aha**: hit "↑ Ask Genius (7×)" on that reply. The same question re-runs
   through the top tier: visibly better answer, model chip flips to a 70B+ model,
   price jumps ~7x. Both chips are extracted from zkTLS proofs, so the switch is
   not just visible, it is provable.
5. **End & rate** → settle: one testnet tx splits the escrow. The receipt links the
   settlement tx, João's payment note, and your refund note on midenscan; the refund
   auto-lands back in the wallet balance (~1 min).
6. Trust check: flip one hex digit in `keys/notary.pub.hex`, send a message — the
   oracle rejects the unknown notary and nothing is charged. Revert; works again.

## Headless E2E

```bash
./stitch.sh          # both tiers notarized + verified, models asserted to differ, settled on testnet
./stitch.sh --mock   # MockChain settlement regression only (fast, offline)
```

Timing: ~15 s per message (7-8 s notarized model call + verify), ~1-2 min for
browser-proved escrow funding, ~30-60 s for settlement.
