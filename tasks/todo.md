# BARTOK — Build Todo

Current plan: `~/.claude/plans/i-want-to-resume-breezy-hickey.md` (testnet MVP cycle)
Previous plan: `~/.claude/plans/i-wanna-work-on-goofy-honey.md` (prototype cycle, closed)

Demo of a seller-driven marketplace for verifiable, private AI inference, settled on Miden.

## Cycle 2 — Private notes via Guardian + multisigs (IN PROGRESS 2026-07-04)

Bartok-Guardian = dedicated clone `~/Code/bartok-guardian` (branch `bartok`, ports patched to 3300/50052, ACK-key file provider). NEVER touch `~/Code/guardian` (Gaylord's upstream tracker). Run: `bartok/guardian/run.sh` (keygen subcommand + testnet server).

- [x] **P0 Bartok-Guardian** up on testnet, /pubkey stable.
- [x] **P1 operator + João multisigs**: settlement via `bartok_settle` custom proposal (propose→Guardian ACK→advice-inject→submit). João's payment consumed into HIS multisig via consume_notes v2, DECOUPLED as a background reconcile (off Rita's critical path; joao_sweep drains stuck queues). Verified on testnet.
- [x] **P2 private notes**: escrow/payment/refund all NoteType::Private; browser↔bridge↔Rust handoff via serialized Note/NoteFile bytes (no node import-by-id).
- [x] **P3 Rita = Guardian multisig** (CORE verified): persistent Falcon signer (AuthSecretKey serialize→localStorage), create-or-recover account, mint-consume + escrow custom proposal all Guardian-countersigned. Escrow funds a private 25,000 BART note, balance debits to exactly 25000 on testnet. Refund-consume: final verification in progress.

Accounts (this run): Rita `0x7495ed…`, operator `0x3edc50…`, João `0xad383b…`, BART faucet `0x7d6d02…`. All in miden/accounts.json.

## Cycle 2 gotchas (hard-won 2026-07-04)
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
      contract ported to the typed `#[note]` macro (11 felts, charge as note arg, recipients
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
      storage, remote prover), refund absorb by note id
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
