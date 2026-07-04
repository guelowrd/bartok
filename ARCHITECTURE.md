# BARTOK — how the parts fit together

BARTOK is three components that compose into one flow: a **buyer UX with a real in-browser
Miden wallet**, a **proof that the seller really ran the model** (zkTLS), and **on-chain
settlement on Miden testnet** that pays per actual usage.

## End-to-end flow (testnet MVP)

```
 BUYER (browser)                          BRIDGE (server.js)                    AI PROVIDER
 ───────────────                          ──────────────────                    ───────────
 in-browser Miden wallet                  per message:
 escrows 25,000 BART        ── chat ──>   run the prompt through a        ──>   openrouter.ai
 (BartokSettlement note,                  zkTLS-instrumented client       <──   {model, usage, answer}
  proved via remote prover)                    │
        ^                                      │  TLSNotary attestation (notary = BARTOK key)
        │ reply + verified model/tokens        ▼  discloses model + max_tokens + usage (labeled),
        │ + charge (tier price)                   redacts API key / prompt / answer
        │                                 ORACLE (off-chain, oracle.rs)
        │                                 verifies presentation + notary key,
        │                                 charge = total_tokens x tier price
        │                                      │ accumulate per session
        │        end & rate                    ▼
        └──────── settle ──────────────>  settle_session (operator account)
                                          consumes the escrow note with charge as the NOTE ARG
                                          -> P2ID(charge) to João + P2ID(refund) to buyer
                                          (both on testnet, visible on midenscan)
```

## What's built vs pending

| Step | Component | Status |
|---|---|---|
| Buyer chat UX with real wallet + escrow + receipt links | `ux-prototype/` (Vite + `@miden-sdk` 0.15) | **Working on testnet** |
| Seller dashboard (João): live jobs + settlements via SSE | `ux-prototype/seller.html` | **Working (live feed)** |
| Prove real model + exact token usage, redact secrets | `zktls-spike/` | **Working, real openrouter.ai, real notary key** |
| Oracle: verify proof + notary, per-tier pricing, verified model | `zktls-spike/openrouter-example/oracle.rs` | **Working** |
| Two real tiers (Basic 9B @1/token, Genius 70B+ @7/token) + "Ask Genius" comparison | `server.js` + `index.html` | **Working** |
| Escrow split note (charge as note arg, recipients precomputed) | `miden/contracts/settlement-note/` | **Working: MockChain test green + live on testnet** |
| Testnet ops (accounts, BART faucet, escrow params, settlement) | `miden/integration/src/bin/` | **Working** |
| Gate settlement on the oracle on-chain | — | Deferred (see below) |
| Multi-seller marketplace, real ratings/tips, Hermes lane | — | Post-MVP |

## Settlement design notes (v0.15)

- **Charge enters as the note ARG at consumption time** (`arg[0]`), because a session's
  total charge is only known at "End & rate"; the escrow note itself is created at session
  start. The MockChain test exercises the same path (`extend_note_args`).
- **P2ID recipients are precomputed by the note creator** and carried in the 11-felt note
  storage (the creator knows target ids, serials, and the P2ID script root). This keeps the
  note script allocation-free and avoids a midenc 0.9 operand-mangling bug in
  `note::build_recipient` when called from note-script context. Trust-wise it is equivalent
  to deriving recipients on-chain from creator-supplied ids: either way the escrow creator
  picks the payees, and the operator validates the escrow off-chain before serving.
- Script-created **public** notes need their recipients registered with the transaction
  (`expected_output_recipients` client-side, `extend_expected_output_notes` in tests).

### Deferred: on-chain oracle gating
The note trusts the executor-supplied charge (and the operator's server enforces
budget/pricing off-chain). The cryptographic on-chain gate is the next increment; the
planned approach is restricting the settlement transaction to the oracle/operator account
so its native Falcon auth over the tx summary binds the exact split.

## Trust model
- zkTLS (TLSNotary) proves provenance/usage; BARTOK's **notary key** (in `keys/`) is the
  trust anchor. The oracle hard-fails on presentations signed by any other notary.
  (Single oracle for the MVP; a threshold attestor set to harden.)
- The buyer's wallet and the escrow/settlement/refund are real testnet objects, all
  linkable on midenscan.
- The free-model lane uses OpenRouter within its ToS. A subscription-backed lane
  (Hermes / Codex) is the first post-MVP phase and carries its own ToS questions.

See each component's own README and `zktls-spike/ARCHITECTURE.md` for details.
