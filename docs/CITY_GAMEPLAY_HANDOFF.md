# City gameplay update: handoff

Branch `city-gameplay`, 2026-10-23. Everything is inside `city/` except two small test updates in `cult/test`.
No database migration is needed and no server code changed.

## What players see now

- **Welcome and daily goals.** A first-visit welcome asks "villager or Chog holder?" and opens the right place.
  A goals card gives three things to do each village day, each with a "Show me" button.
- **Chog card in tabs.** Life, Home, Market, Council, Soul (server only) and Settings, instead of one long page.
  Life shows "Saving up for…" (exactly what the next home still needs) and the Chog's milestones.
- **Visible results.** Coin and material pops over whoever earned them. The Fountain and Market Hall are built in
  3D as people fund them, with a construction stage before they finish.
- **Camera.** An opening glide onto the village, a follow cam when a Chog is picked ("Village view" or Esc to
  return), and framing that keeps clear of the side panel and the phone's bottom sheet.
- **Walking on roads.** Residents walk the roads and bridges instead of sliding through houses and water.
- **Personal routines** (rules change, see below): each Chog has its own lunch hour, sticks with a job for a
  while, keeps its own spare stock, and social Chogs stay up later. No more herd.
- **"While you were away" recap** on return: what your Chogs built and said, your villager's pay, town news.
- **Longer goals.** Homes go to level 5, with names per style (cottage → manor, workshop → guildhall,
  treehouse → tree palace) and new 3D models. Titles (Settler → Master Builder, Gardener). A shared village rank:
  Hamlet → Village → Town → City.
- **Celebrations and sound.** Banners and confetti for your own home levels and titles, finished projects and rank-ups;
  soft synthesised sounds (no audio files) with a mute button by the clock.
- **Plain words.** Players see hours and days, not ticks. "Fixture" is now "Demo village", the constitution is
  "City rules", "Citizen C" is "Villager C".
- **The town grows as people arrive.** Only homes in use are drawn, plus two free lots for settlers. When the
  main island fills, a new district rises across a footbridge (east, then west, then south: 8 homes each).
  Newcomers' Row grows a row at a time.

Art review pages: `?preview=homes` (all 15 homes) and `?preview=chog`. `?view=map` forces the flat map.

## Things that touch your side

1. **Ruleset is now `city-m3-life`** (from `city-m2-citizens`). The simulation changed: per-Chog routines
   (`temperament` in `src/simulation/policies.ts`) and home levels 3–5 (`HOME_RECIPES` in `src/shared/rules.ts`;
   every cost stays under the storage cap of 20, so `city_agents` checks still hold). `pgCity.initialize` adopts the new
   ruleset on restart. Live Chogs will behave differently from that point.
2. **`city/src/fixtures/world.json` now has 36 plots** (p13–p36 are the growth districts). The server's admission
   already takes the first free plot in this order, so the main island fills before any district. The old
   "every one of City's 12 plots is taken" refusal now comes at 36.
3. **Test edits in `cult/`:** `test/db/cityApi.test.ts` imports `RULESET_VERSION` instead of a hard-coded name;
   `test/cityWorld.test.ts` expects 36 plots (and checks the first 12 are the main island).
4. **New state needed for two features I left out** (both need a column, so they're yours to decide):
   real coin rewards for daily goals, and things villagers can buy (home upgrades, outfits).

## A decision for both of us: game speed

`TICK_MS` is 10 s, so a village day is about 6 real minutes and a Chog can reach Master Builder in roughly half an
hour. That suits the demo. For players to come back over days, the live server should probably tick slower (one
village hour every 2–5 minutes). It's one number, but it changes the feel of the whole game.

## What was tested, and what wasn't

- `npm --prefix city run typecheck`, `test:unit` (130 tests), `test:web` (37 tests), `build` and `build:server`
  all pass. New tests cover goals, recap, pops, celebrations, routines, home levels, ranks, growth and walking routes.
- Checked by hand in the demo village at laptop, tablet and phone widths.
- **Not tested end to end with the real server and Postgres** (wallet sign-in, bringing a real Chog in) with the new
  screens. Please do one run after merging: sign in, bring a Chog, open its card, step away and back.
- `cult` tests: 125 pass. Two fail on this Windows machine for setup reasons, not this change:
  `test/chain/evm.test.ts` needs the root contracts compiled, and `test/cityFeed.test.ts` reads the contract doc's
  examples, which the regex misses with Windows line endings.

## Demo tools (demo village only, Town tab)

"Skip a village day", "Step away for a village day" (shows the recap), "A new Chog moves in" (watch the town grow),
and the rule-change buttons. Good for the submission video.
