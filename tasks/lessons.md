
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
