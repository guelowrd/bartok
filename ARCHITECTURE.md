# BARTOK — how the parts fit together

BARTOK is three components that compose into one flow: a **buyer UX**, a **proof that the seller
really ran the model** (zkTLS), and **on-chain settlement** that pays per actual usage (Miden).

## End-to-end flow

```
 BUYER (ux-prototype)                     SELLER node (Hermes + zkTLS)        AI PROVIDER
 ─────────────────────                    ───────────────────────────        ───────────
 type a message,            ── job ──>    run the prompt through a      ──>   api.anthropic / openai
 pick a brain level,                      zkTLS-instrumented client     <──   reply: {model, usage, answer}
 pay from balance                              │
        ^                                       │  TLSNotary attestation  [zktls-spike: WORKING]
        │ "verified" + final charge             ▼  proves provider + model + max_tokens + usage,
        │                                        redacts API key / prompt / answer
        │                                  ORACLE (off-chain)            [NOT BUILT — the seam]
        │                                  verify zkTLS proof, then sign an
        │                                  RPO Falcon-512 attestation over
        │                                  commitment(model, usage->charge, prompt-hash)
        │                                       │
        │                                       ▼
        └───────────── settle ───────────  MIDEN settlement note        [miden-settlement]
                                            verify Falcon sig  (increment 2: PENDING)
                                            split escrow: pay seller usage*price,  (increment 1: WORKING)
                                            refund buyer the rest   -> two P2ID output notes
                                            only commitments on-chain; prompt/answer stay private
```

## What's built vs pending

| Step | Component | Status |
|---|---|---|
| Buyer chat UX (money-first, "verified" chip) | `ux-prototype/` | Mock, done |
| Seller dashboard | `ux-prototype/seller.html` | Mock, done |
| Prove real model + exact token usage, redact secrets | `zktls-spike/` | **Working, tested against real openrouter.ai** |
| Escrow split into seller-pay + buyer-refund (2x P2ID) | `miden-settlement/` (incr 1) | **Working, MockChain test green** |
| Verify oracle Falcon-512 sig in the note before paying | `miden-settlement/` (incr 2) | Pending (de-risked) |
| **Oracle**: verify zkTLS proof -> sign Falcon attestation | — | Not built (the connective seam) |
| Embedded wallet + real escrow funding | — | Not built |

## The seam, concretely

The two working halves already speak the same language, so the oracle is the only missing connective code:

- The zkTLS spike notarized a **real** call and proved `usage = {prompt 81, completion 64, total 145}`
  for model `openai/gpt-oss-20b:free` (see `zktls-spike/RESULTS.md`).
- The Miden settlement note splits an escrow on a `charge` value (see `miden-settlement/`).
- `charge = usage * price_per_token`. So the zkTLS attestation's `usage` is exactly the settlement
  note's input. The **oracle** is the service that: (1) verifies the TLSNotary proof off-chain,
  (2) computes the commitment over `{model, usage->charge, prompt-hash}`, (3) signs it with
  RPO Falcon-512 — which is what increment 2 of the note will verify on-chain.

## Trust model
- zkTLS (TLSNotary) proves provenance/usage; an off-chain **notary/oracle** is the trust anchor
  (a single oracle for the demo, a threshold attestor set to harden).
- Miden verifies the oracle's Falcon-512 attestation **natively** and settles privately
  (only commitments + payment on-chain).
- The closed-model lane breaches provider ToS; this is a proof-of-concept, not a product.

See each component's own README and `zktls-spike/ARCHITECTURE.md` for details.
