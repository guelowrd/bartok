# BARTOK

Peer-to-peer marketplace for **verifiable AI inference** — the "Uber of LLMs". Buyers chat and
pay per reply; sellers run each reply on their own AI capacity; every reply is **cryptographically
verified** (which model ran, for how many tokens) without exposing the API key, prompt, or answer;
and (in the full design) settled privately on **Miden**.

## What's here

- **`ux-prototype/`** — clickable UI prototype (neo-brutalist, no build step). Open `index.html`:
  it's the buyer chat app; the seller dashboard is behind the small "Earn" link. Each reply shows
  a live price and a "✓ verified" chip — click it to see what's *proven & public* vs *kept private*.
- **`zktls-spike/`** — a working proof that a real model-API call can be cryptographically proven
  (model + token usage) while redacting the API key, prompt, and answer. Built on
  [TLSNotary](https://tlsnotary.org). See `zktls-spike/RESULTS.md` and `zktls-spike/ARCHITECTURE.md`.

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

## Status
- Phase 0 — UX prototype: **done**
- Phase 1 — zkTLS verification: **done** (real openrouter.ai call proven end-to-end)
- Phase 2/3 — Miden settlement (oracle re-signs RPO Falcon-512, on-chain usage-based split): next
