# BARTOK — how the parts fit together

BARTOK composes four pieces into one flow: a **buyer app whose wallet is a Guardian
multisig** (all technicals hidden behind an Uber-style UX), a **proof that the seller
really ran the model** (zkTLS), an **application Guardian** ("Bartok-Guardian") that must
co-sign every value-moving transaction, and **private on-chain settlement on Miden
testnet** that pays per attested usage.

## The BarŦok (Ŧ)

The BART faucet is minted with **decimals = 2**, so the denomination lives on-chain:
**1 base unit = 1 Basic LLM token** (the peg), and **Ŧ1.00 = 100 base units** ≈ a short
sentence of output. Charges are attested in base units by the oracle — a 28-token reply
costs exactly 28 base units (Ŧ0.28). Display shows whole Ŧ everywhere except the final
Barter summary, which settles in exact cents. Genius is priced at 7× Basic. Display
anchor: $0.10 per million tokens.

## End-to-end flow (cycle 2)

```
 RITA (browser)                            BRIDGE (server.js)                   AI PROVIDER
 ──────────────                            ──────────────────                   ───────────
 wallet = Guardian multisig                per message:
 (persistent Falcon signer;                run the prompt through a       ──>   openrouter.ai
  create/recover on first visit)           zkTLS-instrumented client      <──   {model, usage, answer}
        │                                       │
        │ escrow: PRIVATE BartokSettlement      │  TLSNotary attestation (notary = BARTOK key)
        │ note as a Guardian CUSTOM PROPOSAL    ▼  discloses model + usage (labeled);
        │ (request bytes built in Rust;            redacts API key / prompt / answer
        │  propose → co-sign → submit)        ORACLE (off-chain, oracle.rs)
        │                                     verifies presentation + notary key,
        ▼                                     charge = tokens × tier price (base units)
 BARTOK-GUARDIAN (:3300/:50052)                    │ accumulate per session
 co-signs every value move on the                  ▼
 buyer/operator/seller multisigs;         settle_session (OPERATOR multisig)
 canonicalizes deltas as testnet          "bartok_settle" custom proposal consumes the
 confirms them                            escrow (unauthenticated input, full note bytes;
        ▲                                 charge as the NOTE ARG) → P2ID(charge) to João
        │ refund NoteFile (bytes)         + P2ID(refund) to Rita — all notes PRIVATE.
        └── consume-notes proposal ────── João's payout lands via his own consume
            absorbs the refund            proposal, reconciled off Rita's critical path.
```

Everything user-facing is abstracted: Rita sees Credits/BarŦoks, holds, and receipts —
never the words wallet, note, escrow, Guardian, or Miden.

## What's built vs pending

| Step | Component | Status |
|---|---|---|
| Rita's app: Guardian-multisig wallet, top-up codes, holds, receipts | `ux-prototype/` (+ vendored `@openzeppelin/miden-multisig-client`) | **Live: bartok-ten.vercel.app** (desktop + iOS + Android) |
| Bartok-Guardian (application Guardian, dedicated fork) | `guardian/run.sh` → `guelowrd/bartok-guardian`, branch `bartok` | **Running (testnet)** |
| All three parties as Guardian multisigs (Rita, operator, João) | `setup_multisigs`, browser wallet | **Working on testnet** |
| Private notes end-to-end (escrow, payment, refund, byte-handoff rails) | bridge + `build_escrow` + `settle_session` | **Working** |
| Prove real model + exact token usage, redact secrets | `zktls-spike/` | **Working; Basic runs `/no_think`, Genius reasons** |
| Oracle: verify proof + notary, per-tier pricing in base units | `oracle.rs` | **Working** |
| Escrow split note (charge as note arg, recipients precomputed) | `miden/contracts/settlement-note/` | **Working: MockChain test + testnet** |
| Guardian policy-ACK (validate charge against attestation before co-signing) | — | Deferred (see below) |
| Multi-seller marketplace, real ratings, always-on backend host | — | Post-MVP |

## Settlement design notes (v0.15)

- **Charge enters as the note ARG at consumption time** (`arg[0]`): the session total is
  only known at "End barter", while the escrow note is created at session start.
- **P2ID recipients are precomputed by the note creator** and carried in the 11-felt note
  storage (keeps the note script allocation-free; sidesteps a midenc 0.9 operand-mangling
  bug in `note::build_recipient`). Trust-equivalent to on-chain derivation from
  creator-supplied ids.
- **Private notes travel as bytes**: the browser serializes the escrow `Note` for the
  bridge; the settlement consumes it as an *unauthenticated input*; the refund returns as
  a serialized `NoteFile` that the wallet imports and consumes via a Guardian proposal.
- **One WASM instance rule**: the app never constructs SDK objects for the escrow — Rust
  (`build_escrow`) emits the full `TransactionRequest` bytes and the browser drives the
  proposal over bytes (`submitCustomFromBytes`), avoiding cross-instance wasm-bindgen
  failures. On iOS, `window.Worker` is hidden before the SDK import (WebKit kills the
  SDK's workers; main-thread WASM + remote proving works everywhere).

### Deferred: Guardian policy-ACK
Every settlement now **requires Bartok-Guardian's co-signature over the exact transaction
summary**, and Guardian only co-signs deltas that consistently extend each account's
canonical state. What it does not yet validate is business policy — that the charge in a
`bartok_settle` proposal matches an oracle attestation. That policy hook (an upstream
Guardian change) is the gating endgame; until then the note trusts the operator-supplied
charge, bounded by the escrowed hold.

## Trust model
- **Nothing is custodial.** Funds live in the buyer's multisig or in on-chain notes;
  Guardian co-signs and backs up state, it cannot move funds alone.
- zkTLS (TLSNotary) proves provenance/usage; BARTOK's **notary key** (`keys/`, gitignored)
  is the trust anchor — the oracle hard-fails on any other notary. (Single oracle for the
  MVP; a threshold attestor set to harden.)
- Wallet, escrow, settlement, and refund are real testnet objects; settlements are
  Guardian-countersigned proposals with canonicalized deltas.
- The free-model lane uses OpenRouter within its ToS; a subscription-backed lane is
  post-MVP and carries its own ToS questions.

See `DEMO.md` for the runbook and `zktls-spike/ARCHITECTURE.md` for proof-lane details.
