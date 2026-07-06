# BARTOK UX pass — brainstorm notes (2026-07-04)

Goal: Uber-grade abstraction. Buyer sees money, levels, and progress; tokens, felts,
notes, and proofs live behind progressive disclosure. Three waits to manage:
escrow ~60-120s (once per session), reply ~15s (frequent), settle ~30-60s (once).

## 1. Abstract the token away
- Buyer-facing currency is dollars (or "credits"). Ŧ stays as the internal unit and
  appears only in nerd mode. Balance chip: "$4.60". Charge chip: "−$0.15 ✓ verified".
- Tier cards quote typical replies, not per-token rates: "Basic · about $0.03 a reply",
  "Genius · about $0.20 a reply". A small "how pricing works" sheet explains metering
  (per-token, verified count) for whoever asks.
- Escrow language -> card-hold language: "We place a $2.50 hold. Whatever you don't
  spend comes back when you end the chat." Never say escrow/note/budget-units.
- "Get BART" -> "Add funds" (demo top-up). Receipt keeps midenscan links behind a
  single "view on Miden" disclosure row instead of three raw links.
- Tap the verified chip -> bottom sheet with progressive depth: model + tokens first,
  then "proof details" (notary, TLS session, tx links) for level 3 curiosity.

## 2. Waiting: steps, not spinners
- Session start becomes a visible 3-step checklist that ticks:
    1. Matching you with João        (~2s, instant gratification)
    2. Placing your $2.50 hold       (the ~90s prover step, with honest "usually ~1-2 min")
    3. Opening the chat              (tick + focus input)
  Determinate-feeling beats spinner; each tick is a small win.
- OVERLAP the big wait: as soon as the tier is picked, start the hold in the
  background and let the buyer type their first question meanwhile. Send unlocks
  when the hold lands. Most of the 90s disappears behind typing.
- Honest ETAs from history: server keeps rolling averages per stage; UI says
  "usually ~15s" / "~1-2 min" and only worries the user if 2x over.
- Reply wait (15s): fake-stream the final text (typewriter render) so the answer
  feels alive; rotate playful stage micro-copy while proving:
  "sealing the conversation transcript…", "the notary is stamping João's work…",
  "double-checking João really used the big brain…".
- Settle wait: the receipt renders instantly with rows filling in as events land
  (charge -> refund -> tx link -> "refund landed ✓" confetti).

## 3. Gamify lightly (funny > flashy)
- Uber metaphor animation: a tiny courier (João's avatar) drives from "you" to
  "João" during matching/hold, and drives BACK with your change during settlement.
  One looping CSS animation, huge narrative payoff.
- Nerd mode toggle (in the receipt or a corner): live feed of the REAL steps
  (MPC-TLS handshake, proof built, oracle verdict, note submitted, block included).
  Doubles as trust theater for technical viewers; hidden by default.
- Micro-delights: confetti when the refund lands; João's avatar "thinks" (animated)
  during genius replies; the Ask-Genius boost gets a small "brain upgrade" animation.
- First-run: max 3 coach marks (balance = money, chip = verified for real, End & rate
  = get unused money back). No tour longer than that.

## Open questions for Gaylord
- Dollars or neutral "credits" for the buyer-facing unit?
- Keep midenscan links visible in MVP demos (sales value) or fold them into nerd mode?
- How playful is too playful for the target demo audience (investors vs devs)?
