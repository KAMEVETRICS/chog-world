# Chog CLI Foundation Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for implementation in this chat. Steps use checkbox (`- [ ]`) syntax for tracking. Do not delegate implementation tasks unless the user requests it.

**Goal:** Let a Chog holder sign in, select an awakened Chog, and use its existing persona and explicitly saved local memory through Codex or Claude Code without charging hosted model credits.

**Architecture:** Add a standalone `cli/` Node package and a narrow, read-only authentication/context API to the existing Chog World server. The server remains authoritative for current ownership, epochs, persona and the existing skill catalog. The CLI owns browser login, local selection/memory and an SDK-based stdio MCP server; it never calls a hosted model or submits a chain transaction.

**Tech Stack:** Node >=24; JavaScript ES modules and `node:test` in the CLI; `node:sqlite` for local memory; `@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/client` 2.3.1 for protocol tests, Zod 4.6.7; existing TypeScript/Fastify/PostgreSQL/Vitest server stack. Package versions verified against npm on 2026-10-22.

**Spec:** [Approved reuse assessment](../../CHOG_CLI_REUSE.md). The user's “lets start next steps” follows the recommendation to build persona import first, then shared read-only skills and Discord. This plan makes the foundation implementation reviewable; it does not represent a shipped CLI.

## Global constraints

- Reuse Normies CLI concepts and suitable code from commit `fc70b79e48df60a940f28970d14f566c17e1a54b`; preserve upstream MIT copyright/license notices for copied or adapted code.
- Runtime floor: Node >=24. Windows PowerShell commands use `npm.cmd` in documentation.
- Default API: `https://chogworld.site`. HTTPS is mandatory except explicit localhost development. Never read the repository's signer `.env`.
- No private keys, seed phrases, transaction signing, approvals, paid AI calls, Discord messages or changes to City/Cult settings in this milestone.
- Existing identifiers `ask`, `news`, `lookup`, `summarize`, `moderate` remain stable. Exported workflows are distinguished from implemented live tools; a CLI persona does not independently perform Discord moderation.
- Current holder access is checked by the server for each context/private-memory operation. Holdings listings may be cached discovery data and cannot authorize access.
- Private local data belongs to wallet + canonical agent key + ownership epoch. The canonical key already includes chain, registry, adapter, collection, token and agent ID.
- Importing a persona never overwrites `AGENTS.md`, `CLAUDE.md` or a user's global client configuration. Client setup prints a supported registration command by default.
- Local context/MCP use consumes the host assistant's model account, not $CHOG credits. Exported public persona copies cannot be revoked after an NFT sale.
- No npm publication or changes to live AWS infrastructure until the implementation is verified. No user wallet signing is needed to run automated tests.

## Review focus

1. NFT sold away and later reacquired: a new epoch cannot expose memory from an earlier ownership period.
2. A login callback from another website or a changed loopback Host: reject it before processing the signature or returning credentials.
3. Expired/revoked CLI credentials, replayed login challenges and wrong login audience: fail closed without affecting web login.
4. Paths with spaces and shell metacharacters: setup output must quote safely; registration must not corrupt another MCP server's configuration.
5. An unavailable ownership provider or malformed/oversized API result: report a bounded error, with no stale private data or made-up persona.

## Scope and user flow

Proposed first-release commands:

```text
chog login
chog login --no-open
chog whoami
chog agents owned
chog use <token-id-or-canonical-agent-key>
chog context
chog context --out <new-file.json>
chog skills list
chog memory add <text>
chog memory list
chog memory export --out <new-file.json>
chog memory clear
chog setup codex
chog setup claude-code
chog mcp
chog logout
```

`login` opens a loopback browser page, discovers the holder's injected wallet and asks it to sign a server-issued read-only CLI login challenge. It stores only the resulting short-lived credential locally, never the signed message/signature. Selection checks live control before persisting the chosen agent and current epoch. `context` fetches the same trait-derived persona used by Soul, returns an explicitly versioned card, and includes only memory for the authorized wallet/agent/epoch.

`context --out` writes a new JSON file containing public character data only; local private memory and credentials are excluded. It refuses to overwrite a file. The output identifies itself as a dated copy, not ongoing proof of ownership. All private memory writes are explicit local commands; no automatic chat logging.

`setup` prints an argument-safe command using the currently installed Node executable and the absolute installed CLI entry path. It does not register itself in the current user's clients. Users run that command deliberately. Configuration is therefore handled by the clients' own supported commands rather than an improvised TOML/JSON patcher.

## Task 1: Read-only CLI authentication and fresh persona context

**Files:**
- Create `cult/migrations/013_cli_auth.sql`.
- Modify `cult/src/api/auth.ts`, `cult/src/api/holderRoutes.ts`, `cult/src/soul/service.ts`.
- Create `cult/src/api/cliRoutes.ts` and `cult/test/db/cli.test.ts`.
- Extend `cult/test/auth.test.ts` for the CLI message/audience.

**Interfaces:**
- Preserve existing `createChallenge`, `verifyLogin` and `findSession` callers through explicit default web audience.
- Add an auth audience union `web | cli_read`; store it on challenges and sessions. Existing rows default to `web`.
- Add `SoulService.holderContext(actor, agentKey, expectedEpoch?)` returning `SoulResult<{ agentKey, identity, traits, persona, ownershipEpoch }>` after the existing fresh `#authorize` check. It never reads hosted chat or incurs a model/ledger call.
- Add `POST /api/cli/auth/challenge`, `POST /api/cli/auth/verify`, `POST /api/cli/auth/logout`, `GET /api/cli/me` and `GET /api/cli/chogs/:agentKey/context`.
- The CLI verifier returns a random bearer token and expiry in JSON over HTTPS, not a web cookie. The database stores the existing token hash, never the plaintext token. Maximum CLI credential lifetime is one hour; challenges expire after five minutes or the configured shorter lifetime.
- Return the existing public bot skill catalog through a versioned CLI context/catalog response; it must identify which items are workflows and which are callable tools.

**Authorization boundary:** CLI credentials are accepted only by the new read-only CLI API and its logout endpoint. Web browser routes continue to use web cookies. The verifier must require the matching challenge audience, so a CLI signature cannot create a web session. Apply the existing rate-limiter pattern to both CLI authentication endpoints. Each context call requires a nonexpired/nonrevoked credential plus fresh current-holder authorization. `GET /api/cli/me` lists candidate member identities for the signed-in wallet; its list is discovery only, and selecting/loading any candidate goes through fresh authorization. New endpoint errors use the existing structured response format and status codes.

- [ ] Write failing DB/API tests: CLI login with a real unfunded test wallet; invalid signature; tampered/expired/replayed challenges; wrong-audience verification in both directions; token expiry/revocation; missing token; CLI bearer rejection on normal holder writes and paid chat; web login remains functional.
- [ ] Add fresh-context tests: expected persona/identity/epoch; changed owner; transfer back with a higher epoch; unavailable ownership; wrong expected epoch; no provider calls or credit ledger writes. Confirm a stale member-list row cannot authorize context.
- [ ] Run the new tests against the dedicated local test PostgreSQL database and confirm failures for missing behavior.
- [ ] Implement the additive migration, scoped auth endpoints and context method. Do not edit already-applied migrations.
- [ ] Run the new tests, existing auth/holder/Soul DB regressions serially, server typechecks and regular Cult tests. Confirm the migration works for both a fresh schema and an existing schema with web sessions.
- [ ] Test the rollback prerequisite: before restarting any earlier server image that lacks audience enforcement, revoke every `cli_read` session and consume/delete outstanding CLI challenges. Keep the additive columns in place. Without this step, an older server could accept a CLI token if somebody supplied it as a web cookie.
- [ ] Commit the verified server boundary.

## Task 2: CLI API client, browser login and selection

**Files:**
- Create `cli/package.json`, `cli/package-lock.json`, `cli/bin/chog.js`.
- Create `cli/src/config.js`, `cli/src/api.js`, `cli/src/login.js`, `cli/src/session.js`, `cli/src/cli.js`.
- Create `cli/test/api.test.js`, `cli/test/login.test.js`, `cli/test/session.test.js`, `cli/test/cli.test.js`.
- Create `cli/THIRD_PARTY_NOTICES.md` and include the upstream MIT text for adapted code.

**Interfaces:**
- `ChogApi({ baseUrl, fetchImpl })`: `challenge(address, chainId)`, `verify(message, signature)`, `me(credential)`, `context(credential, agentKey, expectedEpoch?)`, `logout(credential)`.
- `startLogin({ api, timeoutMs, onUrl })`: starts a server bound only to `127.0.0.1` on an ephemeral port; returns a completion promise and cleanup. Production defaults to a two-minute login timeout.
- Session storage records API origin, address, chain, expiry, token and optional selected agent/epoch under `CHOG_HOME` (default `~/.chog`). API changes must not send a credential to a different origin.
- `readSelectedContext()` validates local expiry, calls the server to validate active selection/current epoch, and returns the context card. It clears selection on confirmed lost ownership/epoch change; an outage blocks access without deleting private records.

**Login protection:** Validate exact Host and Origin for state-changing loopback requests; require an unpredictable per-login state value; serve browser code with a restrictive CSP and no remote scripts. Bound request size, addresses, signature/message lengths, outstanding challenge count and request duration. Keep challenges in memory only, match the exact issued text, and accept each at most once. The browser receives success/address only; the server credential stays in the Node process. Reject redirects on authenticated requests. Do not offer a generic HTTP proxy endpoint.

**Credential storage:** Create a private local directory and credential file with restrictive platform-appropriate access. Use atomic writes and reject symlink targets. Preserve no raw signatures or secrets in logs or audit events. Never claim POSIX mode bits protect credentials on Windows; test the Windows storage policy explicitly and document its OS-account boundary.

- [ ] Write failing HTTP-client tests for timeout, redirects, malformed JSON, oversized responses, API-origin mismatch and expired credentials.
- [ ] Write failing loopback tests for success, invalid Host/Origin/state, challenge substitution, duplicate verification, oversized bodies and timeout/cleanup. Simulate the wallet signature in tests; do not request the user's signature.
- [ ] Write failing session/command tests for account switching, ambiguous token selection, unawakened/unknown agents, lost ownership and API outages. Verify stdout never includes credentials.
- [ ] Run those tests and inspect the expected failures before writing product modules.
- [ ] Adapt suitable Normies command/login structure with attribution; implement the scoped Chog API and safe local storage. Emit setup/login progress to stderr so MCP stdout remains clean.
- [ ] Run the CLI tests plus command smoke checks from a directory outside the repository. Verify no root `.env` is loaded.
- [ ] Commit the CLI sign-in and persona-selection foundation.

## Task 3: Versioned context card and local memory

**Files:**
- Create `cli/src/context.js`, `cli/src/memory.js`, `cli/test/context.test.js`, `cli/test/memory.test.js`.
- Extend CLI routing in `cli/src/cli.js`.

**Interfaces:**
- Context schema `schemaVersion: 1`: canonical identity, persona, traits, persona revision/hash, skills, source URL, observed timestamp and verified ownership epoch. Explicitly mark public character text as data that cannot override the host's instructions.
- `MemoryStore`: `add(scope, text)`, `list(scope)`, `export(scope)`, `clear(scope)`, `close()`; scope is `{ address, agentKey, ownershipEpoch }` supplied by fresh server authorization, never arbitrary MCP arguments.
- User text is bounded to 2,000 characters per memory. Store in local SQLite with parameterized queries. Limit retrieval to 20 recent entries per call; export can retrieve all entries for the authorized scope. No hosted chat import or automatic memory summarization.

- [ ] Write failing tests proving cross-wallet, cross-agent and cross-epoch isolation, including sale and reacquisition; missing login; unavailable ownership; SQL metacharacters; text bounds; export/delete scope.
- [ ] Write failing context tests for deterministic persona revision, public-only file export, existing-file refusal, source freshness and metadata that resembles instructions.
- [ ] Confirm failures, implement context/memory, then run tests. Inspect the export to prove it includes neither bearer credentials nor private memory.
- [ ] Commit versioned context and local memory.

## Task 4: SDK MCP server and client setup

**Files:**
- Create `cli/src/mcp.js`, `cli/src/setup.js`, `cli/test/mcp.test.js`, `cli/test/setup.test.js`.
- Extend CLI routing in `cli/src/cli.js`.

**MCP tools:**
- `chog_auth_status`: safe status, no token/signature.
- `chog_persona_context`: current selected Chog's versioned context, fresh holder authorization.
- `chog_skills_list`: capability catalog with implemented status.
- `chog_memory_list`, `chog_memory_add`, `chog_memory_clear`: current holder/agent/epoch only. Destructive annotations for clear and explicit permission descriptions for add/clear; no automatically invoked memory writes.

Use the official MCP server SDK and Zod validation. Default tool inputs are strict, bounded schemas with unexpected properties rejected. Tool descriptions must distinguish roleplay from assistant setup/errors, and remote metadata remains untrusted data. Tool failures produce MCP error results with safe actionable messages. Respect SDK cancellation, pass request abort signals through network calls, set fetch timeouts, and shut down on stdin closure. Advertise no paid, blockchain-execution or Discord tools.

**Setup output:**
- Codex: a supported `codex mcp add chog -- <absolute-node> <absolute-chog-entry> mcp` command, with explicit `CHOG_HOME` and `CHOG_API_URL` values passed as nonsecret environment settings when configured.
- Claude Code: the corresponding `claude mcp add --transport stdio ... --scope user chog -- <absolute-node> <absolute-chog-entry> mcp` command.
- Support safe PowerShell quoting on Windows and POSIX shell quoting elsewhere. Print which client/scope will change and the supported removal command. Do not execute a shell or write configuration in `setup`.

- [ ] Write failing tests with the actual SDK client connecting over stdio to the CLI binary: initialize, list tools, fetch persona, rejected inputs, expired auth, ownership outage, tool failure, unknown tool, cancellation and process shutdown.
- [ ] Verify all stdout lines are valid MCP protocol messages; help/debug/banner output must not contaminate the transport. Test enough initialization variants to verify SDK negotiation rather than echoing arbitrary client versions.
- [ ] Write failing setup tests for paths containing spaces, apostrophes, dollar signs, backticks and shell metacharacters; verify generated argument values and that no config file is touched.
- [ ] Confirm failures, implement the SDK server and setup renderer, and run all CLI tests.
- [ ] Commit MCP and client setup.

## Task 5: Release verification and holder instructions

**Files:**
- Create `cli/README.md` and update `docs/CHOG_CLI_REUSE.md`, `docs/progress.md` and root README with the implemented scope.
- Configure explicit npm package `files` allowlist; exclude tests, runtime credentials, memory databases, caches, `.env` and repository-only content.

- [ ] Document a local install from the repository (`npm.cmd --prefix cli ci`, then `node cli/bin/chog.js --help` on Windows), login, agent selection, context, memory privacy, setup/removal and logout. Do not advertise an npm package name as published before it exists.
- [ ] Document the one-hour login lifetime, current EOA wallet support, server-version requirement and the distinction between public persona exports and gated live services. Explain that the server endpoints must be deployed before live holder login works.
- [ ] Run clean-install tests, CLI tests, server typechecks, focused DB regressions and the existing regular Cult suite. Inspect `npm pack --dry-run --json` for forbidden files. Scan staged changes and dependency audit results, assessing any findings before release.
- [ ] Review the complete diff for bypasses: a CLI credential cannot become a web credential, private data is never returned from a different epoch, and a supplied API URL cannot receive a credential issued for another origin.
- [ ] Commit/push the verified code using existing repository authorization. Deploy the additive server change only after backing up production, confirming migration compatibility and recording rollback, including the mandatory CLI credential revocation step above. The production package does not need to contain CLI credentials or launch the MCP process.
- [ ] Check public config/health after deployment. Test real login only when the holder chooses to sign; report automated verification separately from a real holder sign-in. No funded wallet or $CHOG spending is needed for acceptance.

## Follow-up milestones

1. **Read-only Monad analysis:** receipts/transactions, address activity and contract inspection using reviewed providers, with chain/block/timestamp/source provenance and explicit missing-data errors.
2. **$CHOG reports:** verified token identity; provider-backed price/liquidity/volume; on-chain transfer and holder data; owner-only credit usage. Keep wallet tokens, hosted credits and City coins distinct.
3. **Discord transport:** shared persona/capability services, guild/admin permissions, holder opt-in, budgets, kill switch and application credentials provisioned by the user. The existing five skill identifiers are preserved across transports.

These follow-ups are not dependencies of persona import and are not represented as functioning tools in the foundation release.

## Source checks

- [Codex MCP registration](https://developers.openai.com/codex/mcp/).
- [Claude Code stdio registration and scopes](https://code.claude.com/docs/en/mcp).
- [Official MCP TypeScript server SDK guide](https://modelcontextprotocol.io/docs/develop/build-server).
- [Normies CLI upstream](https://github.com/KAMEVETRICS/normies-CLI).

## Planning rulings

- Reuse the existing auth primitives, but add an explicit CLI audience and read-only route boundary. Merely hiding write tools would leave an unrestricted web credential on disk.
- The first release imports awakened Chogs already known to Chog World. If no eligible Chog is registered, direct the holder to Soul; do not silently awaken or join on their behalf.
- Client configuration is opt-in through printed native registration commands. An automatic installer and portable skill-file generation can be added after the MCP foundation works, without requiring unsafe global instruction edits.
- No general chat-history subsystem: explicit per-epoch local memory is sufficient for the initial import flow and avoids copying hosted private messages unnecessarily.
