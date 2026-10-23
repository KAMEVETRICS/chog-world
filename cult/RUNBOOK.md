# Chog World Order runbook (City, Cult and Soul)

How to run, check and operate Chog City, Chog Cult and Chog Soul, which run in one server. Commands are for PowerShell from the `cult` folder unless stated otherwise; copy the
command lines only. Designs: `../docs/superpowers/specs/2026-10-19-chog-cult-design.md` and
`../docs/superpowers/specs/2026-10-19-chog-city-design.md`; City's simulation, rules and UI are the City team's
`../city` package, which this server stores and schedules. City contract:
`../docs/superpowers/specs/2026-10-19-cult-city-contract.md`.

## What is ready, and what isn't

| Implemented | Remaining or operational work |
| --- | --- |
| Home page with three doors (Soul, City, Cult). Chog Soul (`/soul/`): sign in, Genesis holdings through Multicall3, browser-wallet awakening with an onchain registration URI, City/Cult admission, persona, credits, AI consent and chat | Configure provider keys and top-ups separately for each hosted installation |
| Cult: rules engine, scheduler, PostgreSQL, public API and SSE, SIWE login, holder actions, `/cult/` UI | Contract-wallet login (ERC-1271) is not supported |
| City: the City team's 3D UI and pure simulation on PostgreSQL; 12 Chog plots, 30 citizen lots, gathering, construction, needs, mood, decor, jobs, market, gifts, hiring, projects, proposals, votes and council; ownership fences and balanced books | Further art and gameplay iteration; run fixture and database acceptance checks before rollout |
| Live Monad ownership reader: adapter bindings, Transfer-log epochs, reorg handling, recorded-response and local-EVM tests; checked-in mainnet adapter manifest | Verify the manifest against your selected RPC at startup |
| `serve:live`: chain 143, Secure cookies, verified manifest, fixture-setting refusal and trusted-proxy limits; Docker Compose hosting kit with documented smoke tests | Configure and verify your own production deployment and backups; this runbook does not assert that an external VPS is currently healthy |
| Chog Bots: four profiles, fixed skills, epoch-bound holder settings, activity and web try-it | Discord transport is not implemented yet |
| Live City reader (`CITY_API_URL`), checked against a stand-in City | |
| Fixture server running City and Cult together; two-viewer acceptance demo (7 checks) | |

Fixture mode invents holders and ownership. Never expose it publicly: it binds to 127.0.0.1 only.

## First-time setup

Needs Git, Node 24 or later and Docker Desktop. From a new checkout, run these commands from the
repository root first:

```
npm.cmd ci
npm.cmd --prefix city ci
npm.cmd --prefix cult ci
npm.cmd run compile
Set-Location cult
```

If you have not cloned it yet, use `git clone https://github.com/KAMEVETRICS/chog-world.git` and
`Set-Location chog-world` first. From `cult/`, start the dedicated local test database and check the server:

```
npm.cmd run db:up
npm.cmd run typecheck
npm.cmd run check
npm.cmd run test:db
```

The server runs from TypeScript source with `tsx` and loads City's code from `../city`, so City's packages
must be installed too. `db:up` starts PostgreSQL 17.6 at 127.0.0.1:55432 (test values only). `check` runs typecheck and the
local tests. `test:db` runs the PostgreSQL tests, including the acceptance demo.

## Watch the acceptance demo

```
$env:CULT_DATABASE_URL="postgres://cult:cult-local-test@127.0.0.1:55432/cult_test"; npm.cmd run demo:acceptance
```

It takes about 5–10 seconds plus the build, and prints one line per acceptance item: agent votes and holder overrides,
flash-joining, the switch cooldown, a sale mid-vote, racing schedulers, City going down, and two viewers
seeing identical history. It uses its own throwaway database schema and removes it afterwards. Exit
code 0 means all 7 passed.

For the in-memory story without a database: `npm.cmd run demo`.

## Run the fixture server and UI

```
$env:CULT_DATABASE_URL="postgres://cult:cult-local-test@127.0.0.1:55432/cult_test"; npm.cmd run serve:fixture
```

Open http://127.0.0.1:8787/ for the landing page, City (`/city/`), Cult (`/cult/`) and Soul (`/soul/`). City ticks
every 10 seconds; Cult follows the demo timing, a 6-minute cycle. Regent, Ember and Jester start Social
(they visit the Plaza, Tavern and Workshop and earn Cult presence) and Banker starts as a Gatherer;
the rest build. Optional settings, set before starting:

| Setting | Effect |
| --- | --- |
| `OPENROUTER_API_KEY`, `SOUL_MODEL` | Switch Chog Soul's AI on (chat, AI debate and votes). The key stays in the environment; never paste it into chat or commit it. Model defaults to `anthropic/claude-haiku-5.5`. |
| `SOUL_DEV_CREDITS` | Credits granted once to `CULT_DEV_HOLDER` for trying chat (default 50 CHOG). Fixture credits are never bought. |
| `CULT_DEV_HOLDER=<your wallet address>` | Gives the fixture Chogs Drifter and Pilot (tokens 7 and 8) to your wallet. They start outside City: sign in on `/city/` and use **Bring a Chog** to move them in, then try the owner panels in City and Cult. Signing in only signs a message. Use a fresh database (or schema) when you change it: holders are read at admission. |
| `CITY_API_URL=<City origin>` | Follow a separately hosted City's event stream instead of running City in this server. |
| `PORT`, `CULT_ORIGIN` | Port (default 8787) and the exact origin the browser uses (default `http://127.0.0.1:<port>`). |

Stop it with Ctrl+C. For UI work with hot reload, run the server, then `npm.cmd run web:dev` and open
http://127.0.0.1:5173/cult/.

## Run the live server (Monad mainnet)

To host it on your own server with HTTPS (Docker Compose with PostgreSQL and Caddy), follow
`../deploy/README.md`. The steps below are what that stack runs.

Needs the checked-in mainnet manifest and a PostgreSQL database used for nothing else. A roster is optional.
City runs in the same server unless `CITY_API_URL` names a separately hosted one. Never point it at a database that served fixtures: it refuses to start if it finds fixture
Chogs or Chogs from another manifest.

1. Use `../deployments/manifests/monad-mainnet.json` for the existing Chog mainnet adapter. It records
   adapter `0x4a8d56dcadb3bd4f8d9776e9e6f6211b845c6b02`, activation block `115003560`, its receipt and
   runtime-code hash. Startup checks those against the chain. For a separate deployment, make a new
   manifest from its confirmed deployment record. That command only reads the adapter's receipt, block and runtime
   code. It refuses prepared or pending records, runs the same checks as startup, and never overwrites a
   file. Share the same manifest with City.

   ```
   npm.cmd run manifest -- ..\deployments\<time>-monad-mainnet.json manifest.json
   ```

2. Optional: write a roster of Chogs to admit to the Cult and City at start. Without one the server starts
   empty, and holders bring their own awakened Chogs in from `/city/` (12 plots); each also joins the Cult.
   Contracts come from the manifest, never from the roster. Every entry must be awakened under the
   manifest's adapter.

   ```json
   { "chogs": [ { "name": "Regent", "tokenId": "12", "agentId": "4107", "traits": { "Head": "Crown", "Aura": "Royal Aura" } } ] }
   ```

3. Start it:

   ```
   $env:CULT_DATABASE_URL="<live database>"; $env:CULT_ORIGIN="https://cult.example.com"; $env:CULT_MANIFEST_PATH="../deployments/manifests/monad-mainnet.json"; npm.cmd run serve:live
   ```

| Setting | Effect |
| --- | --- |
| `CULT_ORIGIN` | Required. The exact HTTPS origin browsers use. The SIWE domain, the Origin check and Secure cookies follow it. |
| `CULT_MANIFEST_PATH` | Required. The verified deployment manifest (chain 143 only). |
| `CULT_ROSTER_PATH` | Optional. The roster (step 2). |
| `CITY_API_URL` | Optional. A separately hosted City to follow (HTTPS, or HTTP to a loopback address behind the same proxy). Without it City runs in this server, admits the roster into its 12 plots and serves City's UI from `../city/dist` (built by `serve:live`). |
| `MONAD_MAINNET_RPC_URL` | HTTPS RPC, default `https://rpc.monad.xyz`. Errors and logs show only its host. |
| `CULT_HOST`, `PORT` | Listen address, default `127.0.0.1:8787`, for a reverse proxy in front. |
| `OPENROUTER_API_KEY`, `SOUL_MODEL` | Optional. Switches Chog Soul's AI on. Without a key, chat says AI is off and Cult stays rule-based. |
| `SOUL_TREASURY`, `SOUL_START_BLOCK` | Optional, together. Opens $CHOG top-ups: holders send $CHOG (`0x3500…7777`) to this treasury address, and finalized transfers from the start block on are credited to the sender's wallet. Use a fresh wallet you control as the treasury, and set the start block to the current block when you open top-ups. |
| `CULT_TRUSTED_PROXY` | The reverse proxy's IP addresses or CIDR ranges, comma-separated: `127.0.0.1` when it runs on the same host. Only requests from these peers have the visitor's address read from `X-Forwarded-For`, for the per-IP sign-in limits; anyone else's header is ignored. Unset trusts no one, so behind a proxy every visitor shares one limit. |
| `CULT_TIMING` | `production` (default) or `demo`. |

It refuses `CULT_MODE` other than `live`, `CULT_DEV_HOLDER`, an HTTP origin, a `CULT_TRUSTED_PROXY`
entry that is a host name, a hop count or a `/0` range, a manifest for another chain, a manifest the
chain does not confirm, and roster Chogs that are not awakened or cannot be read.
Startup checks the manifest against the chain, migrates the database, then indexes the collection's
Transfer logs from the adapter's deployment block before serving. Catch-up time depends on RPC limits,
latency and how far behind the projection is; live startup fetches up to four log chunks concurrently.
Progress persists between starts. Follow the projection progress and RPC errors in the logs; five
failed passes in a row stop startup. Docker smoke-test observations and hosting instructions are in
`../deploy/README.md`; they are not a current production health check.

### Live ownership

`src/chain/` reads ownership from finalized blocks only. For each Chog it checks `bindingOf(agentId)`
on the adapter (the binding must be this collection and token) and `controllerOf(agentId)`, both
pinned to the block hash the Transfer-log projection has reached, and cross-checks the holder with the
token's latest indexed transfer. The ownership epoch is 1, plus one for every Transfer of the token
since the adapter's deployment block, so A→B→A gives a new epoch each time. A transfer that a reorg
removes adds two more, so epochs never go back and a seller's epoch never returns. A Chog is `burned`
only when its latest indexed transfer went to the zero address and the collection reports no owner.
Observations can be up to about 1.5 seconds old plus Monad's one-block finality lag; every holder
action still checks the expected epoch.

## Chog Soul: AI and the $CHOG economy

Design: `../docs/superpowers/specs/2026-10-20-chog-soul.md`.

- Holders top up by sending $CHOG to `SOUL_TREASURY` from the wallet they sign in with. Only finalized
  blocks are read, so a credited deposit cannot be reorged away. Credits belong to the wallet and pay
  for any Chog it holds. They are a prepaid service balance: no withdrawals or refunds.
- Prices (CHOG): chat reply 1, debate line 0.25, vote decision 0.25, council turn 0.5, bot reply 0.5. Each action holds its price, calls
  the model outside any lock, and is charged only if it succeeds and is used; failures are refunded.
  Holds left open by a crash are refunded after 10 minutes.
- AI in Cult is per Chog and off by default: the holder turns it on and sets a daily limit (20 CHOG by
  default). Without credits, consent or a key, the Chog argues and votes by its traits, labelled
  Scripted. Counting and outcomes are always rule-based.
- Chat is holder-only. A sale starts a fresh conversation; the buyer never sees the seller's.
- Watch: `deposit indexer failed` and `credit sweep failed` in the logs. `soul_usage` shows every paid
  action with OpenRouter's reported cost next to its price.

## Health and what to watch

- `GET /api/health` returns `{"status":"ok","revision":...}`, or HTTP 503 if the database is unreachable
  or not initialized.
- The server logs JSON lines. Errors are level 50. Look for `scheduler step failed`, `event poll failed`
  and `City feed:` messages.
- `Ownership reader:` log lines are failed projection passes, reorg rewinds and per-Chog read failures.
- Public events that mean something degraded: `city_gap` (City unreachable or history lost),
  `city_late` (late City ticks ignored), `schedule_gap` (the scheduler was down), and
  `control_changed` with status `unavailable` (ownership can't be checked).

## How it behaves when things fail

| Failure | What happens | What to do |
| --- | --- | --- |
| City down or silent for 45 s | Presence counts zero this cycle, `city_gap` published, votes still decide | Fix City; the reader reconnects by itself and resumes |
| City history lost (`reset`) | One `city_gap`, then counting resumes from City's current revision | Nothing; it recovers |
| Ownership reads fail for a Chog | That Chog is frozen: no votes, no glory, holder actions get 503 | Fix the RPC or indexer; it rejoins at the next check |
| RPC down or slower than the 8-second budget | Affected Chogs read `unavailable` (`rpc` or `indexer_lag`): never a guessed owner or burn | Fix the RPC; the projection catches up by itself |
| Chain reorganization | The projection rewinds to the newest checkpoint still on the chain (64 kept), the generation goes up, epochs of affected Chogs jump | Nothing |
| The adapter's deployment block is no longer on the chain | Every Chog reads `unavailable` (`reorg`); the log says to re-verify the manifest | Re-verify the manifest; should never happen on finalized blocks |
| Cult server down | No phases advance; on restart the overdue phase ends and a `schedule_gap` is recorded | Restart; nothing is simulated for the downtime |
| Two servers running the scheduler | Each transition is applied once (row lock and stale check) | Safe, but run one scheduler on purpose |
| Database down | API returns 500 or 503; the scheduler retries every second | Restore the database; no partial transitions are committed |

## Database

- Migrations run automatically at startup (`migrations/*.sql`, an advisory lock, and a checksum check).
  **Never edit an applied migration**: add a new numbered file. A changed file stops startup on purpose.
- Back up the whole database. `cult_events` is the public history; `cycle_results` stores each
  resolution with input and result hashes.
- `ownership_projection`, `ownership_checkpoints` and `ownership_transfers` (migration 003) hold the
  live ownership index. Don't edit them by hand. A transfer removed by a reorg stays, marked with the
  generation that removed it, because epochs count it.
- Holder sessions store only token hashes. Revoking a session: set `revoked_at` on its `sessions` row.

## Verify each production installation

The live chain reader, mainnet manifest and hosting kit are implemented. Publishing this repository
does not configure or update a running server. For each installation:

1. Use the checked-in manifest for the existing adapter, or create and verify one for an intentionally
   separate deployment. Keep City, Cult and Soul on the same manifest. See `../docs/MAINNET_DEPLOY_STEPS.md`.
2. Configure a dedicated database, exact HTTPS origin, mainnet RPC, backups and optional AI/top-up
   settings using `../deploy/README.md`. Confirm startup finishes its ownership catch-up, health is
   successful, all four pages load, and event streams reconnect through the proxy.
3. Set `CULT_TRUSTED_PROXY` to the actual reverse proxy's address. The proxy must append the connecting
   address to `X-Forwarded-For` or replace the header (nginx:
   `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`), never pass a visitor's header on
   unchanged. Check `trustedProxies` in the `live Cult started` log and verify visitor addresses.
4. Test backup and restore against a scratch database. Keep fixture data out of production.
5. Move rate limits to a shared store if more than one API process runs; today they are per process.

Contract-wallet login (ERC-1271) and the Discord bot transport are not implemented. Ordinary wallet
accounts can sign in; bot profiles and web try-it do not connect a Chog to Discord.
