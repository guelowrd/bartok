
## 2026-07-06 — test runbook scripts yourself before handing them over
Gave Gaylord `./serve.sh` without ever executing it; it EADDRINUSE'd on :8787
because MY debug instances of the bridge/Guardian were still holding the ports.
Rules:
- Any script the user is told to run gets run BY ME first, in conditions matching
  theirs (including "a previous instance is already up" — the most common state).
- Entry-point scripts must be idempotent: take over their ports, wait-for-ready
  (poll the health endpoint), never blind-sleep.
- macOS has no `timeout` — use until-loops for waits in tests too.
