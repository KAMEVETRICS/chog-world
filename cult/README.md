# Chog World Order server: City, Cult and Soul

One server, one sign-in. `/city/` is the agent-run village; `/cult/` is the Crown-versus-Chaos council
that fights over City's places; `/soul/` is the holder's front door for awakening, persona, credits,
AI consent, chat and bot settings. The landing page links all three. City's social Chogs earn Cult
presence. Run and operate the server with [RUNBOOK.md](RUNBOOK.md); start from the [repository guide](../README.md)
for installation of all three packages.

City now includes needs, decorating, citizens, work, a market, projects, proposals, votes and a Chog
council. Bot profiles, fixed skills, settings, activity and web try-it are built; **the Discord transport
is not implemented yet**. AI is optional and needs a separately configured model-provider key.

## Chog Cult

Crown and Chaos fight over Chog City's places. Design: `../docs/superpowers/specs/2026-10-19-chog-cult-design.md`.
Plan: `../docs/superpowers/plans/2026-10-19-chog-cult.md`.

All seven planned tasks are done: the rules engine, a fixture world, PostgreSQL persistence with the
phase scheduler, the public API with a live event stream, holder login and actions, the `/cult` web
interface, and the live City reader with a two-viewer acceptance demo. Operating guide: `RUNBOOK.md`.
City contract: `../docs/superpowers/specs/2026-10-19-cult-city-contract.md`. The live Monad ownership
reader and `serve:live` start script use the checked-in [mainnet manifest](../deployments/manifests/monad-mainnet.json),
which records the deployed adapter and its receipt and runtime-code hash. Startup verifies that
manifest against the selected RPC. The [hosting kit](../deploy/README.md) documents Docker smoke testing;
an installation on your server still needs its own configuration and health checks. These documents
do not assert current production availability.

The following commands run from `cult/` after the root and City dependencies have been installed
and the root contracts compiled as described in the runbook.

```
npm.cmd ci
npm.cmd run typecheck
npm.cmd run check
npm.cmd run demo
```

PostgreSQL tests use a local Docker container (`docker-compose.test.yml`, bound to 127.0.0.1:55432):

```
npm.cmd run db:up
npm.cmd run test:db
npm.cmd run db:down
```

Without `CULT_TEST_DATABASE_URL`, `npm.cmd run check` skips the database tests; `test:db` sets it.

Run a local fixture server (loopback only, fake holders, demo timing) against that database:

```
$env:CULT_DATABASE_URL="postgres://cult:cult-local-test@127.0.0.1:55432/cult_test"; npm.cmd run serve:fixture
```

Then open http://127.0.0.1:8787/ (or `/city/`, `/cult/`, `/soul/`). To try the owner panel with your own browser wallet, also set
`$env:CULT_DEV_HOLDER="<your wallet address>"` before starting: the unaligned fixture Chogs Drifter and
Pilot are then held by that address in the fixture. Signing in only signs a message; nothing is sent on
chain. For UI work with hot reload, run `npm.cmd run web:dev` (port 5173, proxies `/api` to 8787).

Public endpoints: `GET /api/health`, `/api/cult/snapshot`, `/api/cult/places`, `/api/cult/factions`,
`/api/cult/agents/:agentKey`, and `/api/cult/events` (server-sent events). Clients load the snapshot,
then connect with `?after=<snapshot.revision>`; reconnects resume from `Last-Event-ID`. A cursor
outside the replay window gets a `reset` event: reload the snapshot and reconnect.

Holder endpoints (SIWE, ERC-4361; wallet accounts only, contract wallets are not supported yet):

- `POST /api/auth/challenge` `{address, chainId}` returns the exact message to sign (valid 5 minutes).
- `POST /api/auth/verify` `{message, signature}` sets an HttpOnly session cookie (12 hours) and
  returns a `csrfToken`. Each challenge works once.
- `GET /api/me` lists the Chogs the signed-in address holds, with each one's `ownershipEpoch`.
- `PUT /api/cult/members/:agentKey` `{faction?, stance?, expectedEpoch}`.
- `PUT /api/cult/votes/:cycle/:agentKey/:place` `{decreeId | null, expectedEpoch}`.
- `POST /api/auth/logout` ends the session; the Chog keeps its stance.

State-changing requests need the exact configured `Origin` and the `x-csrf-token` header. Cult membership
and vote changes additionally need an `Idempotency-Key` header (8–128 characters). Retrying those with the same key and body returns the first
response; the same key with a different body returns `IDEMPOTENCY_CONFLICT`. A form loaded before
the Chog changed hands returns `CONTROL_CHANGED`. Rate limits (per process): 20 challenges and 10
verifications per IP per 15 minutes, and 10 changes per session per Chog per minute.

`npm.cmd run demo` runs six scripted council cycles with eight fixture Chogs and prints the story:
joining, agent votes, an override, abstention, a flash-join, the switch cooldown, a sale mid-vote,
a City outage and an ownership-read outage. Add a number for more cycles: `npm.cmd run demo -- 10`.

- `src/rules.ts`: every rule and the decree catalog, versioned by `RULES_VERSION`.
- `src/engine/`: `agentVote`/`castAgentVotes`/`holderOverride`, `changeMembership`/`applyTransfer`,
  `resolveCycle`, `cycleClock`. All deterministic: no clock, randomness or I/O.
- `src/shared/identity.ts`: identity and control types copied from the City design.
- `src/city/feed.ts`: the City feed shape Cult reads, and presence counting by cycle time window.
- `src/fixture/`: fixture Chogs (real Genesis trait names, fake holders), fixture ownership with
  transfers, burns and outages, and a fake City feed.
- `src/council/memoryCouncil.ts`: in-memory phases, holder checks, transfer handling and
  resolution, for fixtures and the demo.
- `migrations/` and `src/db/`: SQL schema with check constraints, a locked migration runner, and
  `PgCult`, which does the same work on PostgreSQL. Ownership and City reads happen before the
  `cult_runtime` row lock; each transition re-checks the runtime and commits its events atomically.
- `src/chain/`: live Monad ownership. `HttpJsonRpc` (owned sockets, deadlines, bounded responses,
  errors that show only the RPC host), the Transfer-log projection with block-hash checkpoints and
  reorg rewinds (memory and PostgreSQL stores), `LiveChainReader`, and the deployment manifest checks.
- `src/live/` and `src/cli/serveLive.ts`: the live server's configuration, roster and startup.
  `npm.cmd run manifest -- <deployment record> <manifest>` writes a verified manifest.
- `test/chain/`: the reader against recorded Monad testnet responses (`npm.cmd run record:rpc`
  re-records them, read-only), a scripted chain for reorgs and failures, and a local EVM with the real
  adapter. The local-EVM tests use the repository root's Hardhat and compiled contracts, so run
  `npm.cmd ci` and `npm.cmd run compile` in the root first.
