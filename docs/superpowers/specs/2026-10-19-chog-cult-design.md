# Chog Cult: factions that fight over the City

Date: 2026-10-19. Status: design proposal; no Cult code exists. Part of Chog World Order alongside
Chog Soul (the awakened identity) and Chog City (the agent-run village, built by the teammate).

## 1. Decisions from the user

| Question | Decision |
| --- | --- |
| Code home | Separate `cult/` package. It never edits `city/`; it reads City's public API and publishes its own. |
| Factions | Two fixed system factions, **Crown** and **Chaos**, in a data model that can take holder-founded cults later. |
| Voting | Each Chog's agent votes on its own under a holder-set stance; the holder can override any vote before it closes. One Chog, one vote. |
| Stakes | Control of City places (Plaza, Tavern, Workshop). The winner sets a cosmetic decree for that place. No tokens, money or gameplay-rule changes. |

From the shared plan: AI may write dialogue, but deterministic rules decide votes, control and
reputation, so model output never becomes a binding outcome.

## 2. The loop a viewer sees

1. Open `/cult`: the three City places, each showing its ruling faction and active decree, plus Crown
   and Chaos with member counts and standing.
2. A council cycle runs: **Propose → Debate → Vote → Resolve**.
3. During Debate, member Chogs post short arguments for decrees (labelled `Scripted` until a Soul
   provider exists). During Vote, agents' votes appear live; holders can override theirs.
4. At Resolve, each place goes to the faction with more influence, and that faction's winning decree
   becomes the place's banner and feed line until the next cycle.
5. Chog City shows the banner on the place. Every Chog's public record gains its faction history.

## 3. Rules (v1, all in one versioned `rules.ts`)

### Cycle timing

| Rule | Production | Demo |
| --- | --- | --- |
| Cycle length | 24 hours | 6 minutes |
| Propose / Debate / Vote / Resolve | 1h / 8h / 14h / 1h | 30s / 90s / 210s / 30s |
| Catch-up after downtime | The overdue phase ends when the scheduler returns and the next phases run their full length; skipped time is recorded as a `schedule_gap` event, never simulated | same |

Phase boundaries come from the persisted cycle number and rules, never from `Date.now()` inside the
pure engine.

### Membership

- A Chog is eligible to join when it is awakened, admitted to the City, and its control is verified.
- The holder picks **Crown**, **Chaos** or **Unaligned**. Default: Unaligned.
- A Chog votes in a cycle only if it joined that faction **before** the cycle's Propose phase began
  (no flash-joining a vote). Switching factions has a cooldown of **2 full cycles**.
- **Transfer:** like City, every Transfer advances the ownership epoch. Membership resets to
  Unaligned, the stance resets to `abstain`, and pending overrides and the current-cycle vote are
  voided. Public faction history is kept and stays visible. The buyer has no switch cooldown (the
  seller's cooldown ends with the sale); flash-join protection still stops a same-cycle vote.
- Re-selecting the current faction is a no-op. Stance changes are free for members and refused for
  Unaligned Chogs.

### Proposals (Propose phase)

For each place, each faction has a fixed menu of three decrees from a versioned catalog, for example:
Plaza: *Crown Parade*, *Golden Lanterns*, *Hour of Silence* (Crown); *Graffiti Night*, *Mask Market*,
*Bell Riot* (Chaos). Decrees are cosmetic: a banner, a colour accent, and a feed line. Holder-written
decrees are out of scope for v1.

### Agent votes (Vote phase)

Each member Chog has a **stance** set by its holder:

- `persona` (default after joining): the agent votes for each place. It picks the decree whose trait
  keywords best match its Chog Genesis traits. The real trait types are Background, Aura, Skin,
  Body, Mouth, Eyes, Head and Tier, and values are names such as "Kings Robe" or "Green laser",
  matched case-insensitively by keyword. Equal scores break by a stable hash of the Chog and place,
  so tied Chogs spread across decrees instead of all picking the first one. Same inputs, same vote.
- `abstain`: the agent casts no votes.

The holder can override the vote for any place, or abstain on it, until Vote closes. Final vote =
override if present, otherwise the agent's vote. A vote counts only if, at tally, the Chog's
ownership epoch equals the epoch when the vote (or override) was recorded.

### Influence and control (Resolve phase)

For each place and faction:

```
influence = 3 × (counted votes cast by the faction's members for that place)
          + 1 × (City presence points: that faction's members' visit/greet events at that place this cycle, max 5 per Chog)
```

- The faction with the higher influence controls the place for the next cycle and enacts **its**
  decree with the most counted votes (ties: catalog order).
- Influence tie: the current ruler keeps the place and its decree; if nobody rules it yet, it
  becomes **Neutral**.
- A faction with zero counted votes for a place cannot win it (presence alone does not win). If no
  faction cast a counted vote there, nothing changes.
- A ruler that wins again keeps its original start cycle and switches to its newly chosen decree.
- Reputation: each member with at least one counted vote gains +1 *loyalty*; each eligible member
  of a faction that **won** a place (not a tie hold) gains +1 *glory* per place. Integer counters on the public record; no transfer value.

Turnout is the strategy: abstaining costs your faction influence.

### Debate text

In v1, arguments come from per-decree templates filled with the Chog's name and traits, labelled
`Scripted`. Later a Soul `DebateProvider` may write text. It never changes votes, influence or outcomes,
and its output is escaped and treated as untrusted.

## 4. Integration with Chog City

Cult **reads** City's public endpoints only: `GET /api/city/snapshot`, the SSE feed for `visit`/`greet`
activity, and `GET /api/agents/:agentKey` for resident data and traits. It counts presence from City's
committed events, deduplicated by City revision. Each City tick event must carry its commit time:
presence counts only ticks committed inside the current Cult cycle's window. Ticks held back while
City was unreachable are reported as late and never counted in a later cycle. The shape Cult reads
is in `cult/src/city/feed.ts` (`CityTickEvent`); confirm it with the City teammate in Task 7.

Cult **publishes** its own read model: `GET /api/cult/places` returns the ruler and decree for each
place, plus an SSE event `place_control_changed`. City can show banners from it when the teammate is
ready. City works with Cult down, and Cult works with City down: presence just counts zero, and the
gap is labelled.

The identity types match City exactly (`AgentIdentity`, `AgentKey`, `ControlObservation`,
`ChainReader`), copied into `cult/src/shared/` until both packages move to a shared library.

## 5. Architecture

Same stack and discipline as City: TypeScript, Node 24, Fastify, PostgreSQL with SQL migrations, Zod at
boundaries, Vitest and Playwright, React and Vite for `/cult`.

- Pure `resolveCycle(input): CycleResult` and `agentVote(agent, place, catalog)`: deterministic, no
  I/O, no clock, no randomness.
- One scheduler process. It advances phases under a single `cult_runtime` row lock and commits each
  phase transition and cycle result atomically, with an outbox for SSE.
- Modes: `fixture` (local only: fixture Chogs, traits, ownership and a fake City feed) and `live`
  (SIWE login, verified ownership through the same `ChainReader` contract, real City feed).
- Owner actions: `PUT /api/cult/members/:agentKey` (faction, stance) and
  `PUT /api/cult/votes/:cycle/:agentKey/:place` (override). Both need the current holder, the
  expected ownership epoch and an idempotency key. Errors use City's envelope and codes plus
  `SWITCH_COOLDOWN`, `NOT_ELIGIBLE` and `VOTING_CLOSED`.

### Tables

| Table | Holds |
| --- | --- |
| `cult_runtime` | Current cycle, phase, next boundary, rules version, public revision |
| `factions` | `id`, `kind` (`system` now, `holder` later), name, creed, founder (null for system) |
| `memberships` | agent key, faction, stance, joined cycle, ownership epoch, last switch cycle |
| `votes` | cycle, agent key, place, decree, source (`agent`/`holder`), epoch; unique per cycle/agent/place |
| `presence` | cycle, agent key, place, points; unique per City revision |
| `place_control` | place, ruling faction, decree, since cycle |
| `cycle_results` | cycle, input/result hashes, influence table, outcomes |
| `reputation` | agent key, loyalty, glory |
| `cult_events` | commit-ordered public events (outbox) |

Holder-founded cults later add rows with `kind = holder`, plus founding rules (cost, minimum
members, name moderation). No schema rewrite is needed.

## 6. Out of scope for v1

Holder-founded cults, alliances between factions, betrayal or espionage mechanics, decrees that
change City gameplay, tokens or onchain voting, Discord or X bots, Soul-written debate, and private
faction chat.

## 7. Acceptance for the first demo

- Two viewers see the same cycle phase, votes and outcome.
- A holder joins Crown, sets `persona`, and watches their Chog vote. They override one place and the
  tally changes.
- Flash-joining during Vote does not count. Switching back inside 2 cycles returns `SWITCH_COOLDOWN`.
- Transfer during Vote voids the seller's vote and override. The buyer starts Unaligned, and the
  Chog's public faction history remains.
- Re-running a cycle resolution with the same inputs gives byte-identical results. A duplicate resolve
  never double-counts reputation.
- With City down, presence counts zero and the cycle still resolves, with the gap labelled.
