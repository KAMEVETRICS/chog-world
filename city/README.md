# Chog City

A shared village where Chogs gather wood, stone and food and build their own homes, while holders
watch and change only three settings: **Run/Pause**, **Focus** (Builder / Gatherer / Social) and **Home style**.

This package is independent of the root Solidity project. It never reads the root `.env`.

## Status

| Milestone | State |
| --- | --- |
| Task 1: package, shared contracts, observation shell | Done |
| Task 2: deterministic production/building, three settings, simulated transfer | Done (fixture mode) |
| Server, Postgres, scheduler, wallet login, SSE, live Monad ownership | Done in the Chog server (`../cult`), which runs this package's simulation unchanged; this UI talks to it in server mode (below) |
| City showing Cult rulers; Chog Soul (persona, credits, AI consent, chat) | Done in server mode (below) |
| Art lock, pilot | Not started |

## Run it

```
npm.cmd --prefix city ci
npm.cmd --prefix city run dev:web      # http://localhost:5173
```

The fixture village needs no wallet, RPC or model key. It ticks every 10 seconds; **Advance a tick** skips ahead.
Use **Viewing as** to switch between a visitor and the two fixture holders, and **Fixture tools → Sell** to
simulate an NFT transfer.

The village renders as a 3D, cel-shaded floating island (React Three Fiber) with a day/night cycle tied to the
tick. Drag to orbit, scroll to zoom, right-drag to pan, `[` / `]` to switch Chog. Devices without WebGL get the
2D map. `?preview=chog` opens an art-review stage showing every fixture look (add `&action=chop|wave|sleep|…`).

### Chogs look like their NFTs

Each resident's 3D model is built from its Chog Genesis traits (`src/shared/looks.ts`): Skin sets fur, spikes
and face; Head, Body, Eyes, Mouth, Accessory and Aura map to hats, outfits, eye styles (lasers, BTC glasses,
visors...), mouths, held items and an orbiting aura. The panel shows the real NFT image.

Fixture residents keep test-collection IDs 0–7 but each wears a real Chog Genesis token (labelled "fixture
look"). `src/fixtures/chog-genesis.json` holds the traits of all 1,969 tokens, read from the collection itself:
`tokenURI(id)` on Monad mainnet, then the IPFS metadata it points to. Token #N's metadata is usually *not*
`N.json` (the reveal shuffled them), so looks are always found by token ID. **Fixture tools → Dress the village as
random Chogs** re-dresses everyone from the full collection; `?preview=chog&tokens=954,12` shows any tokens up
close. On the Chog server each resident wears its own token.

## Server mode

The same UI, following the Chog server (`../cult`, one origin with Cult) instead of running the village in the
browser. The server imports `src/shared` and `src/simulation` as they are and stores and schedules them in
PostgreSQL; keep those pure, and change `RULESET_VERSION` with any game number.

```
npm.cmd --prefix city run build:server   # served by the Chog server at /city/
npm.cmd --prefix city run dev:server     # hot reload; /api goes to a server on 127.0.0.1:8787
```

For `dev:server`, start the server with `CULT_ORIGIN=http://localhost:5173` so sign-in accepts the dev origin.

- `src/web/api/http-client.ts`: `HttpCityClient`, the `CityClient` port over HTTP. Snapshot, resident,
  `GET /api/city/me/agents`, `PATCH /api/city/agents/:key/policy` with a CSRF token and Idempotency-Key, and the
  `/api/city/events` stream (each revision delivered once, `reset` reloads). Also SIWE sign-in with a browser
  wallet (`personal_sign`; nothing is sent on chain), sign-out, and `POST /api/city/admissions {tokenId}`.
- `src/web/account/AccountBar.tsx`: replaces the fixture controls in server mode. It shows the server's label
  ("Monad mainnet" or "Fixture Village"), wallet sign-in, and **Bring a Chog**: a holder enters a Chog Genesis
  token number; the server reads its agent from the verified adapter, checks they hold it, and gives it the
  next free plot and the starting grant once.
- Small changes elsewhere: `App` takes `server={{ site }}` for server mode (fixture mode is unchanged);
  `main.tsx` picks the mode from `vite --mode server`; `looks.ts` gives Genesis residents their own token's
  look; `ResidentPanel` labels any non-Genesis look as a fixture look; `PolicySettings` shows the server's
  message when a save is refused for another reason (for example ownership can't be read right now).
- `src/web/cult/`: who rules the Plaza, Tavern and Workshop, read from Cult on the same server
  (`GET /api/cult/places`, reloaded on each `place_control_changed` and on every reconnect of `/api/cult/events`).
  Shown on the 3D place labels, the 2D map and a "Who rules" list in the Roster tab; the last known rulers stay
  up, marked as possibly out of date, while Cult can't be reached.
- `src/web/soul/`: Chog Soul in the resident panel. Everyone sees the Chog's persona; its holder also sees their
  $CHOG credits and how to top up, the AI switch and daily limit for Cult debates and votes, and a private chat
  (a failed message keeps its idempotency key, so resending it can't be charged twice).
- Tests: `test/web/server.test.tsx` (sign-in, bring a Chog, the event stream, save refusals, rulers and their
  updates, persona and chat) against a stand-in server.

## Checks

```
npm.cmd --prefix city run typecheck
npm.cmd --prefix city run test:unit    # simulation, ledger, transfer, determinism, fixture client
npm.cmd --prefix city run test:web     # UI behaviour against the fixture client
npm.cmd --prefix city run build
```

## Layout

- `src/shared/` contains the frozen contracts (`contracts.ts`), strict validation (`schemas.ts`) and every game number (`rules.ts`).
- `src/simulation/` holds pure transitions: `step` (one tick), `applyPolicyChange` and `applyControlChange`. They use no clock, randomness or network.
- `src/fixtures/` holds the seeded 8-resident world and `FixtureCityClient`, which enforces the same version/epoch/controller/idempotency fences the server will.
- `src/web/` is the React UI. It renders committed state only: Chogs walk between committed positions and never predict outcomes.
- `src/web/world3d/` is the 3D world: `Scene3D` (island, roads, places, lots, day/night, camera), `Chog3D` (rig and animation), `ChogParts` (trait-driven hats, outfits, eyes, mouths, items, auras) and `models` (houses, scaffolds, places).

## Rules beyond the design spec

Every number in `src/shared/rules.ts` was checked against `docs/superpowers/specs/2026-10-19-chog-city-design.md`
(§3) on 2026-10-20. The farm (+3 food, no input) matched; the level-2 home was changed to the spec's 12 wood /
8 stone / 4 food over 2 ticks (ruleset `city-m0-3`). Max home level is 2. These behaviours go beyond the spec:
- **Night rhythm.** A village day is 36 ticks. Each active Chog sleeps in its own home from hour 19–21 (staggered by token ID) until dawn at hour 34; sleep ticks are not eligible build ticks. Tick 0 is hour 4, so the plan's 5-tick example is all daytime and unchanged.
- Every resident without a house lives in a tent on its lot (view only), so nobody is homeless.
- A gather that needs food is skipped if its full yield would pass the cap of 20, so food is never wasted.
- A transfer resets every holder setting: paused, builder, cottage (the house already built stays as it is).
- **Social rotation.** Social residents move together between the Plaza, Tavern and Workshop, 4 ticks at each, and greet whoever is at the same place. These are the places Cult counts.
- **Needs and mood (ruleset `city-m1-needs`, Sims-style).** Each Chog has energy, hunger, fun and social, 0–100, starting at 80. Work costs energy 4, hunger 3, fun 1, social 1 per tick; socializing costs energy 2 and hunger 2 and gives fun 6 and social 15; resting gives energy 12, plus 4 per home level, plus 2 fun per decoration. Paused, frozen and ruined Chogs do not change. While awake, a Chog below 35 hunger eats 1 free food (+45; ledger reason `eat`, public change `ate`). Urgent needs come before focus unless a build is under way: below 20 energy it rests; hungry with no free food it farms; below 20 social or fun it goes to the social place and stays until both are back to 60. Mood (`moodOf`) is named after the lowest need when it is below 30, "miserable" when the average is below 30, otherwise cheerful (70+) or content; each decoration adds 3.
- **Home decorating.** The holder buys up to 4 decorations from the Chog's free stores: lantern (2 wood), flower bed (3 food), bench (3 wood, 1 stone), well (1 wood, 4 stone). Each item once; refusals: `ALREADY_OWNED`, `DECOR_FULL`, `CANT_AFFORD`. Ledger reason `decor`, event `home_decorated` with change `decorated`. Decorations stay with the home when the Chog changes hands. Server route: `POST /api/city/agents/:key/decor` `{expectedEpoch, item}` with CSRF and Idempotency-Key.
- **Constitution and live parameters (ruleset `city-m2-citizens`).** `src/shared/constitution.ts` lists the only numbers a vote may change, each with a default, range and largest step per change: farm, forest and quarry yields (3, 3, 2), wage (5 coins) and income tax (20%). They live in `WorldState.params` (versioned) and the simulation reads them; `checkParamChange`/`applyParamChange` refuse anything unlisted, out of range or too big a step. Votes come next; the fixture's Town tab can enact a change directly to demo it.
- **Citizens and city money.** Anyone signed in can join as a citizen with a Chog-like villager (plain looks from `VILLAGER_OPTIONS`; rare traits stay with the NFTs) and a home in Newcomers' Row (8 lots, an islet north of the village joined by a footbridge). A citizen picks a job (farmhand, woodcutter, quarrier, day off); the villager works at that site by day and sleeps at home by night. Work fills the treasury's stores (cap 200 each) and pays a wage in new coins, less income tax to the treasury; full stores pay nothing. New citizens get 10 coins. Coins and stores move only through `AccountEntry` lines (`reconcileAccounts` checks the books). A citizen can vote after working on 3 different village days. Citizens never change what a Chog decides.
- **The economy.** Chogs now hold coins. `applyAction` (`src/simulation/economy.ts`) checks and applies every player action: *gifts* (coins between anyone; materials only Chog to Chog), *trades* at the Lantern Plaza market (the treasury buys and sells; price per unit doubles when its stock is empty, equals `MARKET_BASE` at 50 units and keeps falling as it fills; the constitution's market fee, 10% by default, is the spread), *job offers* (a holder's Chog hires one villager for a job and a wage of 1-10 coins; the villager's output goes into the Chog's stores and the wage comes from its coins, taxed as usual; no coins or no room means no work; a withdrawn offer or a sale sends the villager back to city work) and *shared projects* (the Plaza Fountain adds 3 fun a tick to Chogs chatting at the Plaza; the Market Hall halves the market fee; contributions are capped at what is still needed). The city is founded with 100 coins so the market can buy before taxes come in. A sold Chog keeps its coins and decorations but drops its offer. Every movement is booked (`LedgerEntry` for a Chog's materials, `AccountEntry` for coins, the treasury and project funds) and `reconcileAccounts` checks Chogs, villagers, the treasury and projects.
- **Proposals and votes.** A holder puts a proposal forward through their Chog (one open per Chog, five city-wide): change one or more constitution numbers, or fund a shared project from the treasury. Citizens vote yes or no once they have shown up for work on 3 different village days (the latest ballot counts). A proposal is open for one village day (36 ticks) and closes on the next tick: it passes with more yes than no and turnout of at least 25% of eligible voters (at least 1), and is then enacted under the constitution as it stands, or marked failed if no longer allowed or unaffordable. Funding moves treasury funds to the project on the books. Showing up for work counts towards voting even when full stores mean no pay; the treasury's stores now hold 500 of each.
- **The council (`src/simulation/council.ts`).** Once a village day, on the tick at hour 2, every held, verified and active Chog takes a council turn: it may put one proposal forward, then speaks for or against open proposals (one speech per Chog per proposal, at most 280 characters). A session runs in two passes, proposals then speeches, so proposals filed that morning are debated the same day. A turn comes from the Chog's AI (server only: when its holder opted in to AI and the daily cap allows, paid from their credits; the reply must match `councilReplySchema`) or from the rules-based mind: each focus has views on a few rules (builders favour lower tax and higher wood and stone yields, gatherers lower market fees and higher yields, social Chogs higher wages and tax for projects), holders' private standing instructions add to them, a Chog with no view stays quiet, and it proposes only what its holder asked for. Every part of a turn goes through `applyCouncilTurn` with the same checks as a holder's action; parts that fail are dropped. Holders can also speak for their Chog by hand. Instructions belong to the ownership epoch: a sale clears them.
- Each `city_tick` event carries `data.activities`: one `{agentKey, kind, location}` per resident that acted (`visit`, `greet`, `gather`, `build`, or `idle` for sleeping at home). Paused, frozen and burned residents did not act and are left out.
