# BARTOK — Build Todo

Current plan: `~/.claude/plans/i-want-to-resume-breezy-hickey.md` (testnet MVP cycle)
Previous plan: `~/.claude/plans/i-wanna-work-on-goofy-honey.md` (prototype cycle, closed)

Demo of a seller-driven marketplace for verifiable, private AI inference, settled on Miden.

## Cycle 2 — Private notes via Guardian + multisigs (IN PROGRESS 2026-07-04)

Bartok-Guardian = dedicated clone `~/Code/bartok-guardian` (branch `bartok`, ports patched to 3300/50052, ACK-key file provider). NEVER touch `~/Code/guardian` (Gaylord's upstream tracker). Run: `bartok/guardian/run.sh` (keygen subcommand + testnet server).

- [x] **P0 Bartok-Guardian** up on testnet, /pubkey stable.
- [x] **P1 operator + João multisigs**: settlement via `bartok_settle` custom proposal (propose→Guardian ACK→advice-inject→submit). João's payment consumed into HIS multisig via consume_notes v2, DECOUPLED as a background reconcile (off Rita's critical path; joao_sweep drains stuck queues). Verified on testnet.
- [x] **P2 private notes**: escrow/payment/refund all NoteType::Private; browser↔bridge↔Rust handoff via serialized Note/NoteFile bytes (no node import-by-id).
- [x] **P3 Rita = Guardian multisig** (VERIFIED): persistent Falcon signer (AuthSecretKey serialize→localStorage), create-or-recover account, mint-consume + escrow custom proposal + refund-consume all Guardian-countersigned. FULL CYCLE verified on testnet: 30000 → escrow 25000 → settle → refund 25000 → 30000, ledger exact.

Accounts (this run): Rita `0x7495ed…`, operator `0x3edc50…`, João `0xad383b…`, BART faucet `0x7d6d02…`. All in miden/accounts.json.

- [x] **P4 Rita UX**: Credits/Bartoks (Ŧ) currency, no dollars in chat; vocabulary sweep
  (no Miden/Guardian/escrow/token/multisig in Rita's view); conversation memory
  (MESSAGES_JSON, MAX_SENT_DATA 16KiB, genius max_tokens 512) + friendly truncation notice.
- [x] **P4b funnel**: ONE ECONOMICS config block (peg anchor 1Ŧ=1 basic token, holds, caps);
  buy-credits modal + ILOVEBARTOK (Ŧ1000 private mint); auth-lite (scrypt, users.json) with
  Genius-needs-account + Ŧ500 anon spend cap; tier-based dynamic holds (Basic Ŧ3000/Genius Ŧ10000, balance-capped).
- [x] **P5 docs**: DEMO.md rewritten for the Rita/Guardian flow; stitch.sh marked cycle-1.
- [x] **P6 SHIPPED 2026-07-06**: LIVE at https://bartok-ten.vercel.app (backend = Mac +
  ngrok static domain quote-escargot-headache.ngrok-free.dev; reboot runbook: ./serve.sh
  + ./tunnel.sh, Vercel never touched). Deployed-stack outsider journey VERIFIED end to
  end: fresh wallet → ILOVEBARTOK Ŧ1,000 → balance-clamped Ŧ1,000 hold → Guardian-countersigned
  settle → refund landed, ledger exact. Deploy-day bugs fixed live: CORS lacked PUT
  (signDeltaProposal — ALL browser signing silently dead), ngrok agent displaced by a
  second manual session (free tier = 1 agent), grant < flat hold bricked fresh testers
  (now min(cap, balance) with floors). Chat leg pending only OpenRouter free-lane
  availability (code path proven locally).
  Deploy glue:  (bridge CORS + /guardian reverse-proxy so one tunnel
  serves app API + Guardian; VITE_BARTOK_BACKEND config; vercel.json COOP/COEP; serve.sh +
  tunnel.sh). Vite prod build green. REMAINING (needs Gaylord): actual `vercel deploy` with
  his Pro account + running the cloudflared tunnel + a fresh-Rita acceptance run.

## Cycle 2 simplifications (ponytail, documented)
- Mint stays PUBLIC (Rita absorbs via listAvailable). Private mint (decision 6) deferred:
  the sensitive privacy (escrow/charge/refund) is already private; mint privacy is low value,
  high plumbing (fund_buyer would need to emit a NoteFile). Flagged, not built.
- No mid-session auto re-hold: one balance-capped hold per session; if exhausted, Rita
  finishes (gets the refund) and starts a fresh chat. Simpler than sequential re-holds.
- Courier animation: functional staged copy in place; elaborate animation deferred to polish.

## Deep audit 2026-07-07 (3 parallel expert reviewers: security / architecture / UX)
Two-barter bug NOT reproducible after fixes — verified: 2 full back-to-back barters
(escrow→settle→refund ×2) clean through real multisig+bridge. Likely original cause was
the operator delta-wedge on rapid retries + the retry UI that never shipped (both fixed).
FIXED: static handler served users.json/sessions.json/source publicly (CRITICAL, closed);
XFF-spoof rate-limit bypass; malformed-JSON socket hang; chat-after-settle free reply;
double-settle race (settling guard); settled-session PII/blob leak (evict on settle);
0-reply End stranding; seller 100x display; iOS 100dvh; a11y (live regions, focus-visible,
forms, XSS via textContent). Tests 15→22. Deferred/documented: no wallet-ownership auth
(buyerId self-asserted → spend-cap/account gates bypassable, sybil on codes) — testnet-ok,
must close before BART has value; full UX a11y backlog (keyboard nav on custom controls,
coral contrast) triaged in review.

## Payback/settle gotcha (root-caused + fixed 2026-07-15)
- **The buyer wallet ate its own live escrow.** The web SDK lists custom-script notes as
  consumable by the account that holds their details (it can't evaluate the script), so
  `listAvailable` returned the LIVE escrow to its creator, and the blanket `absorbNotes()`
  background loops (init-sweep on every page load / second tab, post-buy `waitAndAbsorb`)
  consumed it mid-session with charge arg 0 → full self-refund, João stiffed, and the
  operator's settle failed forever with `nullifiers already exist` (Rita saw the infinite
  "Not wrapped up yet / network hiccuped" retry loop, plus Guardian delta-wedge churn from
  each doomed re-submit). Diagnosed from bridge+guardian journals: buyer delta canonicalized
  16:16:23 mid-chat, settle's FIRST attempt failed on the spent nullifier at 16:19:33.
- **Fix (three layers)**: (1) on-chain operator gate — settlement note storage is now
  13 felts (+operator prefix/suffix) and the script asserts `active_account::get_id()`
  matches (P2ID-style target assert; `settlement_gate_rejects_non_operator` MockChain
  test pins it); (2) wallet absorbs ONLY P2ID-script-root notes (mints/refunds), so it
  never attempts a doomed escrow consume; (3) bridge maps `nullifiers already exist` to a
  terminal `escrow_spent` (evict + honest "Already closed out" copy, no retry button) in
  BOTH /api/session/end and the sweeper (shared ESCROW_SPENT_RE).
- **Deploy sequencing matters**: old-artifact escrow notes keep the ungated script (a
  note carries its script), so ship the frontend filter FIRST, drain/evict in-flight
  sessions, then ship backend + new .masp. New escrows are gated from then on.

## Mobile gotchas (hard-won 2026-07-06)
- **iOS WebKit kills the miden-sdk workers** → wallet init dies with the SDK's
  worker-error rehydrator ("Unknown error received from worker", empty payload).
  TWO layers: (1) MidenClient DROPS useWorker:false internally (SDK bug, report
  upstream); (2) a MODULE worker spawns at import-time WASM init — before any
  option can matter. Fix: on iOS UAs, `delete window.Worker` BEFORE the lazy SDK
  import (session-long); desktop keeps workers. Main-thread is fine — proving is
  remote.
- **Debugging phones = error beacons**: POST /api/client-log from the app's
  catch blocks (ua + stack) → bridge log. Decoded minified frames by rebuilding
  the identical chunk locally (same content hash) and slicing line/col.

## Cycle 2 gotchas (hard-won 2026-07-04)
- **Guardian caps pending proposals at 20 per account; there is NO delete-proposal API.**
  The browser absorb loop originally created a NEW consume proposal on every failed
  attempt → hit the cap and semi-bricked test account 0xea88db… (abandoned, ~Ŧ1000
  testnet dust + 20 stale proposals). Fix mirrors the Rust lesson: RESUME-FIRST
  (re-execute an existing proposal matching the available note ids), execute ONCE per
  poll (a failed execute leaves an orphaned delta that must discard first), never
  blind-retry proposal creation. First-sync note discovery on testnet can exceed 3 min
  → absorb windows are 300s with a graceful "on their way" fallback in the buy modal.

- **DUAL @miden-sdk WASM INSTANCE = the big one.** ux-prototype (0.15.3) + the linked
  Guardian multisig client (was 0.15.0) each loaded their own @miden-sdk WASM. wasm-bindgen
  rejects cross-instance values ("array contains a value of the wrong type" from
  FeltArray). Vite dedupe/alias/optimizeDeps.exclude did NOT reliably force one instance
  for a `file:`-linked package. TWO fixes applied together: (1) pin the clone's @miden-sdk
  to 0.15.3 (match); (2) DEFINITIVE — build the escrow TransactionRequest in RUST
  (`build_escrow` bin), drive it bytes-only in the browser (createCustomProposal →
  submitCustomFromBytes), so wallet.js NEVER constructs SDK Felt/Note objects. Added
  `submitCustomFromBytes(bytes, advice)` to the multisig client (PR-able). Lesson: for a
  linked SDK-bearing package, keep all SDK object construction on ONE side.
- **NoteType::Private encodes to felt 0** (Public=1), NOT 2. settle_session must derive
  output note type from `escrow_note.metadata().note_type()`, not a magic felt constant.
- **create_account is LOCAL-only** on the multisig client; must call `register_on_guardian()`
  (push_account) after, or `recover_by_key`/`pull_account` can't find it (each session
  starts a fresh local store by SDK design).
- **Guardian: one pending non-canonical delta per account.** Back-to-back proposals 409
  `conflict_pending_delta`; a client-side execute failure AFTER delta push wedges the
  account until discard (grace + retries — dev config lowered to 60s/6 in main.rs). Wallet
  masks with `withPendingRetry` backoff; joao_sweep is the ops drain.
- **execute_proposal pushes a delta first** — retrying a failed execute deadlocks behind
  its own orphan. Execute ONCE after confirming block inclusion; else reconcile later.
- **multisig.syncState() overwrite guard** throws "incoming nonce N not greater than local"
  right after an execute (Guardian not yet canonical). getBalance reads local via
  client.accounts.getOrImport + AccountInspector, NOT multisig.syncState().
- **Guardian ports are builder-args, not env** upstream — patched to read
  GUARDIAN_HTTP_PORT/GUARDIAN_GRPC_PORT (bartok branch).

## Testnet MVP (2026-07-03) — SHIPPED

- [x] **v0.15 migration**: standalone workspace at `miden/` (no external template checkout);
      contract ported to the typed `#[note]` macro (11 felts — 13 since the 2026-07-15
      operator gate, charge as note arg, recipients
      precomputed); MockChain regression green incl. charge=0 and charge=budget edges
      → verify: `./stitch.sh --mock`
- [x] **Testnet ops**: `setup_accounts` (João `0x09bd26…`, operator `0x363a27…`, BART faucet
      `0x7d6d02…`), `escrow_params`, `fund_buyer`, `settle_session`, `smoke_escrow`
      → verified: real escrow settled on testnet (tx `0x6597…9150`, João auto-consumed)
- [x] **Real notary/oracle keys**: `openrouter_keygen` writes `keys/` (0600); prove.rs loads
      NOTARY_KEY_FILE; oracle rejects unknown notaries (exit 2), requires PRICE_PER_TOKEN,
      serde_json usage parse, extracts the verified model; present.rs reveals labeled
      key-value pairs → verified: tamper test rejects, both prices correct
- [x] **Two real tiers**: Basic = nemotron-nano-9b @1 Ŧ/token, Genius = llama-70b class
      @7 Ŧ/token (4-deep in-tier 429 fallback); server checks the PROOF's model against the
      tier → verified: same prompt through both tiers, models differ, 7x pricing
- [x] **Buyer wallet in browser**: Vite + vanilla + raw `@miden-sdk` 0.15.3
      (`src/wallet.js`); create-or-load, Get BART (mint+absorb), fundEscrow (11-felt
      storage — 13 since the 2026-07-15 operator gate, remote prover), refund absorb by note id
      → verified: full click-through incl. balance ledger check (50,000 − 2,244 = 47,756)
- [x] **The aha ("Ask Genius")**: per-message tier + boost re-ask with stacked comparison;
      verified model chip + price from the zkTLS proof
      → verified in browser: "Arrays start at zero" ($0.03, 9B) vs full paragraph ($0.15, 120B)
- [x] **Live seller dashboard**: SSE (`/api/seller/events`), real jobs + settlements, no
      Math.random → verified: jobs and settle events land live; snapshot totals correct
- [x] **Session settlement from the UI**: End & rate → one testnet tx → receipt with
      midenscan links (tx + both P2ID notes) → refund auto-lands
      → verified: charge 1,777 / refund 23,223, balance ticked to 45,979
- [x] **Headless E2E**: `./stitch.sh` (both tiers + assertions + testnet settle),
      `--mock` for the MockChain regression → verified: E2E OK, tx `0x4500…a1c9`

## Next UX pass (Gaylord, 2026-07-04)
- Abstract token concepts away from the buyer UI (Uber-style: money and simple levels only;
  no per-token prices, token counts, or unit math in the buyer's face). Keep the verified
  MODEL switch visible (the aha), hide the token accounting behind it.
- BART symbol = Ŧ (done); brand spacing after the boxed T (done).

## Deferred (unchanged)
- **Private notes pass**: escrow + P2ID outputs are currently PUBLIC (needed for import-by-id
  discovery + midenscan demo links). To go private: flip noteTypeFelt to 2 and hand the full
  NoteFile over the bridge (buyer refund + escrow to operator) or via the testnet note-transport;
  midenscan links then only show commitments. The buyer ACCOUNT is already private.
- On-chain oracle gating (note trusts operator-supplied charge; operator restricts + validates off-chain)
- Hermes/gpt-5.5 subscription lane (post-MVP phase 1: notarize the Codex backend call)
- Multi-seller marketplace / order book; real ratings/tips/reputation
- tlsn upgrade beyond v0.1.0-alpha.15 (pinned)

## Gotchas learned (2026-07-03)
- `cargo-miden` on PATH was the stale midenup 0.14-channel shim (0.8.1) — its midenc panics
  on SDK-0.13 contracts with misleading errors (duplicate `alloc` symbol, missing ABI fn).
  Fix: `cargo install cargo-miden --locked --force` (0.9.0). Tests were immune (they build
  in-process via the `cargo_miden` lib).
- midenc 0.9.0 mangles operands of `note::build_recipient` when called from note-script
  context ("expected u32" / coded kernel asserts) — avoided by precomputing P2ID recipients
  host-side and passing them in note storage (also simpler + allocation-free).
- Script-created PUBLIC notes fail with "missing details in advice provider" unless their
  recipients ride along: `expected_output_recipients` (client) / `extend_expected_output_notes`
  (MockChain).
- v0.15 renames hit: `PartialNoteMetadata` (with_tag moved), `extend_note_args`,
  fallible `Felt::new`, `AssetAmount` everywhere, `FungibleFaucet::builder()` + policy
  components + `build_with_schema_commitment()`, `AccountType` = Private/Public only.
- Web SDK: numeric auth enum (2 = RpoFalcon512), `useWorker:false`, wasm moves (capture
  `note.id()` before `withOwnOutputNotes`), `TransactionId.toHex()`, refund discovery is
  flaky via tag sync — import by note id (`NoteFile.fromNoteId` + `importNoteFile`).
- OpenRouter resolves model aliases to dated snapshots (`…-20230311:free`) — match on
  base-name prefix, report the proof's string.

## Review (older cycles)
**2026-07-01 — Demo finalized on 0.14 MockChain** (staged progress UX, robustness, full-flow
verify). Superseded by the testnet MVP above; kept for history.
**2026-06-24 — Phase 1 zkTLS spike DONE** — TLSNotary v0.1.0-alpha.15, real openrouter.ai
call notarized end-to-end, selective disclosure verified. See `zktls-spike/RESULTS.md`.
