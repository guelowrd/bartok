# BARTOK zkTLS spike — results (2026-06-24)

**Outcome: SUCCESS.** TLSNotary proves a real model-API call end to end, disclosing exactly the
fields BARTOK settles on and redacting the secrets. This de-risks the load-bearing part of the project.

## What was proven
A real `POST https://openrouter.ai/api/v1/chat/completions` (model `openai/gpt-oss-20b:free`) was
notarized, then verified against the real web PKI. The verifier output showed:

- **Disclosed — request:** `POST /api/v1/chat/completions`, `host: openrouter.ai`,
  body `model` and `max_tokens` (= 64, the cost ceiling).
- **Disclosed — response:** `200 OK`, body `model`, `id`, and `usage` (prompt=81, completion=64, total=145).
- **Redacted (shown as X):** the `Authorization` header value (API key), the prompt (`messages`), and the answer content.
- Signed by the notary's **k256 / secp256k1 ECDSA** key (pairing-free). In BARTOK this notary == the oracle,
  which re-signs the result commitment as **RPO Falcon-512** for native verification on Miden.

This maps 1:1 to the settlement contract: `request.model`, `request.max_tokens`, `response.usage`, all
provable; key + content stay private.

## Stack
- TLSNotary `v0.1.0-alpha.15` (Rust), cloned at `./tlsn`.
- MPC-TLS negotiated fine with openrouter.ai (Cloudflare) — TLS 1.2 path works (the main risk, now cleared).
- Code: `tlsn/crates/examples/openrouter/{prove,present,verify}.rs` (registered in that crate's Cargo.toml).

## Reproduce
```bash
# 1. free OpenRouter key in ../.env  (OPENROUTER_API_KEY=sk-or-...)
cd tlsn
set -a; . ../.env; set +a
# notarize (cycle models if a free one is transiently rate-limited / 429):
RUST_LOG=error,openrouter_prove=info MODEL='openai/gpt-oss-20b:free' \
  cargo run --release --example openrouter_prove
# selective-disclosure presentation + verify:
cargo run --release --example openrouter_present
cargo run --release --example openrouter_verify
```
Artifacts (gitignored): `openrouter.attestation.tlsn`, `openrouter.secrets.tlsn`, `openrouter.presentation.tlsn`.

## Notes / next
- Free models 429 transiently per-provider ("retry shortly"); cycling slugs lands a 200. A BYOK/paid key removes this.
- M1 (stock fixture example) also verified locally first.
- Next phases: oracle service (verify proof off-chain → sign RPO Falcon-512), Miden settlement note that
  verifies that signature natively and does the usage-based split.
