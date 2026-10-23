# Chog City: handover for making it more playable

Date: 2026-10-22. Public information only. For the City teammate; read with `docs/CHOG_CITY_TEAMMATE.md`
(chain addresses) and `docs/superpowers/plans/2026-10-21-chog-world-order.md` (the agreed plan).

## Where City stands

Your `city/` build still runs unchanged at its core. Since your last version it has gained, in your code and style:

| Feature | Where | Ruleset |
| --- | --- | --- |
| Needs (energy, hunger, fun, social), mood, eating, urgent needs before focus | `src/simulation/needs.ts`, `policies.ts` | `city-m1-needs` |
| Home decorations bought from a Chog's stores | `needs.ts` (`applyDecor`), `resident/Needs.tsx` | |
| Constitution: the only numbers a vote may change, with ranges and steps | `src/shared/constitution.ts` | `city-m2-citizens` |
| Citizens: anyone signs in, gets a Chog-like villager, a lot in Newcomers' Row (30 lots on an islet), a job | `src/simulation/citizens.ts`, `town/TownPanel.tsx`, `world3d/District3D.tsx` | |
| City money: wages (new coins), income tax, treasury, Chog coins | `citizens.ts`, `economy.ts` | |
| Gifts, the Plaza market, Chogs hiring villagers, shared projects (Fountain, Market Hall) | `src/simulation/economy.ts`, `web/economy/*` | |
| Proposals and votes: Chogs propose, villagers vote, enacted under the constitution | `src/simulation/governance.ts`, `web/economy/Votes.tsx` | |
| The council: each morning Chogs propose and debate, from their AI or a rules-based mind guided by holders' private instructions | `src/simulation/council.ts`, `web/economy/Council.tsx` | |

Live: the Chog server at `/city/` runs all of it (citizens, economy, votes are stored in Postgres; see
`cult/migrations/007`–`010`). Fixture mode (`npm --prefix city run dev:web`) has Holder A, Holder B and Citizen C,
plus fixture tools: sell a Chog, re-dress the village, enact a rule, skip a village day.

## Ground rules that keep it working

- **The simulation is pure and deterministic.** No clocks, randomness or network in `src/simulation`. Players
  change the world only through `applyAction`, `applyPolicyChange`, `applyDecor`, `admitCitizen`,
  `applyJobChange`; ticks only through `step`. The server replays the same functions, so anything you add there
  works live without server changes, as long as it stays in `WorldState`.
- **Everything is on the books.** A Chog's materials move through `LedgerEntry` (`resources.ts`); coins, the
  treasury and project funds through `AccountEntry`. `reconcileAccounts` must stay empty; tests check it.
- **Change `RULESET_VERSION` in `rules.ts` whenever a game number or rule changes.**
- **New state in `WorldState` needs a server column.** Tell me (or add a `cult/migrations/0xx` file) when you
  add fields to `AgentState`, `CitizenState` or `WorldState`, and when you add a `LedgerReason`,
  `AccountReason`, `PublicChange` or `CityEventType` (the database checks those lists).
- Tests: `npm --prefix city run typecheck`, `test:unit`, `test:web`. They take about a minute together.

## What makes it feel thin today (ideas, roughly by value)

1. **Too little to do as a villager.** A citizen picks a job and waits. Ideas: villager needs and mood (reuse
   `needs.ts`), buying food and decorations with coins, short daily tasks or quests from City Hall, mini-games at
   the sites, chatting with Chogs at the Plaza.
2. **Little feedback.** Wages, trades and votes show as numbers. Ideas: coin pops over villagers, sounds,
   a daily summary ("you earned 60 coins, the fountain is 40% built"), notifications when a vote you joined closes.
3. **The economy drifts.** Wages mint new coins every tick (inflation), and the treasury's stores (cap 500) fill
   within a few days, after which city jobs stop paying. Sinks to add: villagers buying goods, upkeep on homes,
   bigger projects that use stores, a granary. The constitution's wage and tax are the levers votes can pull.
4. **Projects are invisible in 3D.** The Fountain and Market Hall change rules but nothing appears at the Plaza.
5. **The 2D fallback map shows no villagers**, and villagers walk straight over the water to work instead of
   using the bridge (`BRIDGE_ENDS` in `District3D.tsx` is ready for routing).
6. **Voting is slow to reach.** A villager needs 3 working days (~18 minutes of real time) before voting. Fine for
   the live game; the fixture skips days.

## Next on my side (so we don't collide)

Step 3 (the council) is done. Next is Chog Bots: skills and profiles, then the Discord bot, in `cult/`. If you
change the rules-based mind's lines or views in `council.ts`, keep `rulesCouncilTurn` deterministic.
