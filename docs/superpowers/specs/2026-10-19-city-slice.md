# Chog City: the hackathon slice

Date: 2026-10-19. Status: built (see `docs/progress.md`, 2026-10-20). Full design: `2026-10-19-chog-city-design.md` (the rules in its
section 3 apply unchanged unless this page says otherwise). Deadline: Chogathon submission in 3–4 days.

## Decision: City runs in the Cult server

City is built inside the existing `cult/` package and server instead of a separate `city/` package:
one SIWE login and session, one PostgreSQL database, one live ownership reader, one deployment.
City's activity reaches Cult in-process through the same `city_tick` contract
(`2026-10-19-cult-city-contract.md`), read from City's own event table. City keeps its own event
revisions and its own SSE stream at `/api/city/events`, so the two can be split later without changing
either side's contract.

## In the slice

- One village: the six places from the design (Plaza, Tavern, Workshop, Forest, Quarry, Farm) and
  12 plots. Every Chog on the roster is admitted in stable plot order with the one-time grant.
- The deterministic simulation from design section 3: 10-second ticks; gather, build levels 0–2 with
  reservations and two-tick construction; builder, gatherer and social focus; greetings with a
  6-tick cooldown; at most 3 catch-up ticks after downtime, with a public `simulation_gap`.
- **Change:** social Chogs gather at one landmark at a time, moving Plaza → Tavern → Workshop every
  18 ticks (3 minutes), instead of only the Plaza. This makes every Cult place reachable, so a holder
  choosing Social is campaigning for their faction, while Builder grows their home.
- Ownership: the same `ChainReader` as Cult (fixture or live). Unavailable freezes a resident.
  A transfer pauses it, resets focus to Builder, cancels construction and releases reservations, and
  keeps its plot, buildings, resources and history. The buyer must start it again.
- Holder controls: Run/Pause, Focus and Home Style, saved with the expected policy version and
  ownership epoch, CSRF, Origin and an idempotency key, as in Cult. A real change cancels unfinished
  construction.
- A resource ledger whose deltas always sum to the stored balances.
- Public API: snapshot, one resident, SSE events. A `/city/` page with an SVG map, a resident panel,
  the owner panel, an activity feed and a table alternative. Cult rulers' banners appear on their
  places.
- A small `/` landing page linking City and Cult.

## Cut for the deadline

Free movement, 3D, approved final art (functional SVG placeholders only), DMs, chat, trading,
tradable land, model-driven decisions (Soul comes next, as a separate step), reorg handling beyond what
the shared ownership projection already does, and the design's performance targets.
