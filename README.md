# BARTOK

Peer-to-peer marketplace for **verifiable AI inference** — the "Uber of LLMs". Buyers chat and
pay per reply; sellers run each reply on their own AI capacity; every reply is **cryptographically
verified** (which model ran, for how many tokens) without exposing the API key, prompt, or answer;
and (in the full design) settled privately on **Miden**.

## What's here

See **`ARCHITECTURE.md`** for how these three parts compose into one flow.

- **`ux-prototype/`**: clickable UI prototype (neo-brutalist, no build step). Open `index.html`:
  the buyer chat app, with the seller dashboard behind the small "Earn" link. Each reply shows a
  live price and a "✓ verified" chip (tap it for a plain-language "this is real" reassurance).
- **`zktls-spike/`**: a working proof that a real model-API call can be cryptographically verified
  (which model ran, exact token usage) while redacting the API key, prompt, and answer, plus the
  **oracle** (`openrouter-example/oracle.rs`) that verifies the proof and derives the charge. Built
  on [TLSNotary](https://tlsnotary.org). See `zktls-spike/RESULTS.md` and `zktls-spike/ARCHITECTURE.md`.
- **`miden-settlement/`**: the on-chain half, a Miden note that splits the buyer's escrow into a
  payment to the seller and a refund to the buyer (two P2ID notes). Increment 1 (the split) is
  tested green; Falcon-attestation verification is the next increment. See its README.

## Try the UI
```bash
open ux-prototype/index.html
```

## Try the zkTLS proof
```bash
cd zktls-spike
./setup.sh                 # clones TLSNotary, wires in the example (needs Rust + git)
cp .env.example .env       # add a free OpenRouter key: https://openrouter.ai/keys
./test-zktls.sh            # notarize a real call -> verify it -> show tamper-rejection
```

## Try the Miden settlement
```bash
cd miden-settlement
./install.sh                       # wires the contract + test into ~/Code/agentic-template
cd ~/Code/agentic-template/project-template
cargo test -p integration --release --test settlement_split_test   # needs the protocol-0.14 toolchain (see miden-settlement/README.md)
```

## Run the whole pipeline (end-to-end)
After the three setups above:
```bash
./stitch.sh    # zkTLS proof -> oracle (charge) -> Miden settlement split
```
A real run: a zkTLS-proven token usage flows through the oracle into the on-chain split
(e.g. 145 tokens, so the seller is paid 145 and the buyer refunded 435).

## Status
- UX prototype: **done** (mock)
- zkTLS verification: **done**, tested against a real openrouter.ai call
- Oracle (verify the zkTLS proof, derive the charge): **done**, tested
- Miden settlement, increment 1 (escrow split into seller-pay + buyer-refund): **done**, MockChain test green
- End-to-end pipeline (zkTLS -> oracle -> settlement): **working** via `./stitch.sh`
- On-chain oracle gating (Falcon-512 in the note): deferred (Miden 0.14 constraint, see `ARCHITECTURE.md`)
