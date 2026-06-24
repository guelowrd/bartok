# OpenRouter zkTLS example (BARTOK)

The three Rust files here are BARTOK's authored code for the zkTLS spike. They are kept
separate from the TLSNotary checkout (which is large and gitignored) and wired into it by
`../setup.sh`.

- `prove.rs` — notarize a real `POST https://openrouter.ai/api/v1/chat/completions` call
  (real Mozilla web-PKI roots, in-process notary, secp256k1 attestation).
- `present.rs` — build a selective-disclosure presentation: reveal request `model`/`max_tokens`
  and response `model`/`usage`; redact the `Authorization` header (API key), the prompt, and the answer.
- `verify.rs` — verify the presentation against the real web PKI; redacted bytes show as `X`.

## Use
```bash
cd ..            # zktls-spike/
./setup.sh       # clones tlsn @ v0.1.0-alpha.15 and copies these in + registers the examples
cp .env.example .env   # add OPENROUTER_API_KEY (free, https://openrouter.ai/keys)
./test-zktls.sh  # notarize -> verify -> tamper-reject
```

These map onto BARTOK's settlement contract: `request.model`, `request.max_tokens`,
`response.usage` are provable; the key + content stay private. See `../ARCHITECTURE.md`.
