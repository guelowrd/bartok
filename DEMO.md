# BARTOK — demo runbook (Cycle 2: private notes via Guardian + Rita UX)

The "Uber of LLMs" on **Miden testnet**, with private payment rails and an
application **Guardian** (Bartok-Guardian). Three personas:
- **Rita** (buyer) — sees only Credits (Bartoks, Ŧ) and simple brains; every
  technical detail is hidden. Her wallet is a Guardian multisig.
- **João** (seller) — lends spare AI; his dashboard may say "verified on Miden".
- **Béla** (operator) — runs Bartok-Guardian + the bridge (the backend).

Everything runs on your Mac against public testnet. Nothing is custodial:
Guardian co-signs and backs up, it never holds funds; the escrow is a note that
locks Rita's own credits and splits them on settlement.

## Prereqs (once)

```bash
# 1. zkTLS proof lane
zktls-spike/setup.sh
cp zktls-spike/.env.example zktls-spike/.env      # add a free OpenRouter key
(cd zktls-spike/tlsn && cargo run --release --example openrouter_keygen)

# 2. Bartok-Guardian (dedicated clone ~/Code/bartok-guardian, bartok branch)
guardian/run.sh keygen                            # ACK keys (once)

# 3. testnet accounts (BART faucet + operator/João Guardian multisigs)
(cd miden/integration && cargo run --release --bin setup_accounts)
(cd miden/integration && cargo run --release --bin setup_multisigs)

# 4. buyer UI deps + compiled contract for the browser
(cd ux-prototype && npm install && npm run build:contracts)
```

Toolchain: rustup + `cargo install cargo-miden` (0.9.x), Node 18+.

## Run (local)

```bash
./serve.sh                          # Bartok-Guardian :3300 + bridge :8787
cd ux-prototype && npm run dev      # Rita's app → http://localhost:5173
# João's dashboard: http://localhost:8787/seller.html
```

## The Rita demo

1. First visit silently creates Rita's account (a private Guardian multisig).
   Balance shows **Ŧ 0**.
2. **Add credits** → mock card checkout → enter code **ILOVEBARTOK** →
   **Ŧ 1,000** lands (a private mint, consumed via a Guardian proposal).
3. Pick **Basic** → **Find a helper**. A small hold (Ŧ 3,000, capped by balance)
   is set aside — the browser builds + Guardian-countersigns the escrow (~1-2 min,
   masked by the "setting aside your credits" screen).
4. Ask a question. Reply lands with `✓ verified` + its price in Ŧ. Ask a
   follow-up — João remembers the conversation. Hit **↑ Ask Genius** → prompted
   to create a free account (Genius needs one) → after signing up, the same
   question re-runs through the 70B+ brain (verified model chip flips, price ~7×).
5. **End & rate** → settlement (one Guardian-countersigned testnet tx) → receipt
   in Ŧ with a neutral "view record" link → unused credits return to the balance.
6. Anonymous users can spend up to Ŧ 500 before an account is required.

## Honest trust story (say this out loud)

Every value-moving transaction on Rita's, João's, and the operator's accounts
requires **Bartok-Guardian's co-signature** over that exact transaction — Guardian
can never move funds alone, and it only co-signs deltas that consistently extend
each account's canonical state. What Guardian does NOT yet check is business
policy (that a charge matches an oracle attestation) — that's the deferred
policy-ACK hook. So today: infrastructure gating in place, policy hook deferred.

## Nerd view (Béla)

The seller dashboard's live feed is the seed of Béla's ops view. `joao_sweep`
drains any stuck seller-payment proposals. Guardian state is at `guardian/data/`;
every account's deltas go candidate → canonical as testnet confirms them.

## Ship to real Ritas

```bash
./serve.sh                          # backend on this Mac
./tunnel.sh                         # cloudflared → stable https URL
# Deploy Rita's app to Vercel with the backend URL baked in:
cd ux-prototype && VITE_BARTOK_BACKEND=<tunnel-url> vercel deploy --prod
```
The bridge proxies `/guardian` → Bartok-Guardian, so one tunnel serves both.
Multi-Rita note: the zkTLS pipeline is serialized (one answer at a time) —
testers queue under load; fine for the first cohort.

## Economics (all in `ux-prototype/server.js` CONFIG)

REBASED 100:1 (2026-07-06): Ŧ1 = 100 Basic tokens ≈ a short sentence of output.
Still anchored to real cost ($0.10/M tokens → Ŧ1 = $0.00001). The oracle attests
charge = round(tokens × price / 100), min Ŧ1 (PRICE_DENOM). Genius = 7× Basic.
Codes ILOVEBARTOK + _00.._99 = Ŧ100,000 ($1) each, once per wallet, in order.
Anon spend cap Ŧ50,000. Holds: Basic Ŧ500, Genius Ŧ2,000 (min of cap and
balance). Faucet supply: protocol max (~9.2e18). NOTE: pre-rebase test wallets
hold old-unit balances that now read 100× rich — testnet, accepted.
