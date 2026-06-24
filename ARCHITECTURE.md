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
| **Oracle**: verify zkTLS proof -> derive charge | `zktls-spike/openrouter-example/oracle.rs` | **Built + tested** |
| End-to-end pipeline (zkTLS -> oracle -> settlement) | `stitch.sh` | **Working (`./stitch.sh`)** |
| Gate settlement on the oracle on-chain | `miden-settlement/` (incr 2) | Deferred (Miden 0.14 constraint, see below) |
| Embedded wallet + real escrow funding | — | Not built |

## The pipeline, concretely

The three parts are wired together by `stitch.sh`, which runs end-to-end:

1. **zkTLS** notarizes a real `openrouter.ai` call and proves the token `usage` (redacting key/prompt/answer).
2. The **oracle** (`oracle.rs`) verifies that TLSNotary presentation off-chain and derives
   `charge = total_tokens * price`.
3. The **Miden** settlement note splits the escrow on that `charge` (seller paid, buyer refunded).

A real run: 145 proven tokens, so the seller is paid 145 and the buyer refunded 435 on Miden.

### Deferred: on-chain oracle gating
Ideally the note would verify an oracle Falcon-512 *signature* over the settlement commitment before
paying. Miden 0.14's falcon-sig mechanism only signs the *transaction summary*, not a standalone
commitment, so this is deferred. The planned approach: gate settlement by restricting the settlement
transaction to the **oracle account** (its native Falcon auth over the tx summary binds the exact
split). Today the oracle's `charge` flows in as data; the cryptographic on-chain gate is the next step.

## Trust model
- zkTLS (TLSNotary) proves provenance/usage; an off-chain **notary/oracle** is the trust anchor
  (a single oracle for the demo, a threshold attestor set to harden).
- Settlement is private on Miden (only commitments + payment on-chain). On-chain verification of the
  oracle's authorization (Falcon-512) is the deferred step described above.
- The closed-model lane breaches provider ToS; this is a proof-of-concept, not a product.

See each component's own README and `zktls-spike/ARCHITECTURE.md` for details.
