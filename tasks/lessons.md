
## 2026-07-06 — test runbook scripts yourself before handing them over
Gave Gaylord `./serve.sh` without ever executing it; it EADDRINUSE'd on :8787
because MY debug instances of the bridge/Guardian were still holding the ports.
Rules:
- Any script the user is told to run gets run BY ME first, in conditions matching
  theirs (including "a previous instance is already up" — the most common state).
- Entry-point scripts must be idempotent: take over their ports, wait-for-ready
  (poll the health endpoint), never blind-sleep.
- macOS has no `timeout` — use until-loops for waits in tests too.

## 2026-07-07 — scripted edits MUST assert their match (bitten twice)
Two shipped commits claimed changes that silently never landed because
python `str.replace()` found no match and no assert guarded it:
(1) USD_PER_BARTOK removal left a live assignment → runtime crash;
(2) the settle-retry UI block targeted an imagined string → users hit a
dead-end error with no retry for a full day.
Rules: every scripted replace carries `assert old in s`; UI copy that encodes
behavior (retry buttons, error mappings) gets a static guard test; verify the
DEPLOYED artifact contains the change, not just the commit message.

## 2026-07-07 — Vite HMR reloads the page mid browser-test
Edited index.html while a browser-driven two-barter test was running on the Vite
dev server; HMR hot-reloaded the tab and wiped window state, killing the test.
Rule: never edit ux-prototype/ files while a browser test runs against :5173 —
finish/observe the test first, or test against a built artifact.

## 2026-07-15 — Blanket "consume everything" loops + creator-visible custom notes
The wallet's absorbNotes() consumed every note listAvailable returned; the SDK
lists custom-script notes as consumable by their creator, so a background sweep
ate the LIVE session escrow (charge 0 → full self-refund, seller stiffed, settle
dead forever on "nullifiers already exist"). Two rules: (1) any auto-consume loop
must WHITELIST note scripts (P2ID root only), never blanket-consume; (2) a note
that must only be spent by one party needs the restriction ON-CHAIN in its script
(P2ID-style target assert) — client-side politeness is not an invariant. Also:
when a retry loop wraps an on-chain submit, classify errors terminal-vs-transient
first ("nullifiers already exist" can never succeed on retry; evict, don't loop).
