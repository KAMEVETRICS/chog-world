# Chog CLI: reuse assessment and proposed first release

**Updated direction (2026-10-22):** The user chose a local core. The first implementation is in `cli/`, with direct Monad ownership/binding checks and local wallet proof, persona and memory. It does not depend on Chog World authentication or hosted APIs. The original server-dependent auth proposal below is historical; use [the local-core plan](superpowers/plans/2026-10-22-chog-local-core.md) and [CLI guide](../cli/README.md) for current behavior. Market analytics and Discord remain follow-ups.

Reviewed 2026-10-22 against [KAMEVETRICS/normies-CLI](https://github.com/KAMEVETRICS/normies-CLI), commit `fc70b79e48df60a940f28970d14f566c17e1a54b`. This is a source review and build proposal; no Chog CLI has been shipped or installed by this change.

## Recommendation

Use Normies CLI as the starting point for a separate Chog package. Reuse its command organization, browser wallet login, agent selection, context assembly, SQLite memory and stdio MCP concepts. Keep a Chog-specific API adapter rather than forking the entire Normies backend. The upstream MIT license permits reuse; copied code must retain its copyright and license notice (copyright 2026 kongclaves).

The same Chog identity, persona version and skill catalog should feed City, Discord and the CLI. These are different transports, not independent personalities. Holder-private instructions and memories remain separate from the public persona.

## What ports cleanly

| Normies source | Chog adaptation |
| --- | --- |
| `src/cli.js`, `bin/normies.js` | `chog login`, `whoami`, `agents owned`, `use`, `context`, `logout`, `mcp` |
| `src/auth.js` | Browser wallet discovery and a signed login challenge; use Chog World server-issued sessions for hosted access |
| `src/api.js` | Replace Normies API routes with Chog World identity, persona and verified ownership endpoints |
| `src/tools.js` | Selected-persona context, local memory tools and new read-only analysis tools |
| `src/store.js` | Local sessions, explicit memory saves and audit records, with the privacy changes below |
| `src/claude-config.js` | Preserve/backup behavior as a pattern; add distinct Codex and Claude Code installers |

## Changes required before release

1. **Authentication boundary.** Upstream verifies an EOA signature against an exact local challenge and binds its server to loopback. It persists the signed message and signature locally; refreshing the ownership cache does not revalidate the original challenge's expiry. This is local client state, not authorization to call Chog's private hosted APIs. Hosted requests need short-lived, server-verified credentials with revocation and audience/scope checks. Add loopback Host/Origin validation, per-login state, one-use challenges and tests. Decide explicitly whether contract wallets are supported.
2. **Ownership and private data.** Upstream checks ownership through its API, generally with a five-minute cache. Its history/memory tables are keyed by token ID, without holder or ownership epoch. Chog private records must include wallet + chain + collection + token + ownership epoch. Validate session/token consistency; signing in as a later owner must not expose the previous owner's history. Recheck current control for every hosted private operation, fail closed on unavailable verification, and clear active selection on transfer or logout. An exported public persona is a copy and cannot be remotely revoked.
3. **Protocol and validation.** Upstream hand-writes its MCP transport, echoes the client's requested protocol version and does not validate tool arguments against the declared schemas before invoking handlers. Use the maintained MCP SDK with explicit version negotiation, schema validation, tool error results, limits and request cancellation/timeouts. Add actual protocol tests; upstream's package scripts provide a smoke command, not a comprehensive automated test suite.
4. **Client installers.** The existing config helper targets Claude Desktop, including Windows Store paths. Claude Code and Codex need their own supported MCP setup and skill locations. Default to printing a reviewable setup command or config diff; writes must be explicit, preserve other servers and create backups. Never overwrite a user's global instructions file just to import a persona.
5. **Capabilities.** Keep tool allowlists and server-side authorization as enforcement. Upstream's phrase-based guardrail checker is advisory and can flag harmless text; it is not a security boundary. Omit AgentRoom/SwarmSkill trading-session integrations from the first Chog release unless separately requested.
6. **Runtime and storage.** Upstream declares Node >=22 but imports `node:sqlite`; choose and test a precise supported runtime (this repository uses Node >=24). Protect credential storage with platform-appropriate permissions; do not log credentials or raw private memory. Explain local storage and provide export/delete controls.

## Proposed holder experience

These are proposed commands, not currently available binaries:

```text
chog login
chog agents owned
chog use <token-id>
chog context
chog setup codex
chog setup claude-code
chog skills list
chog report monad <address-or-transaction>
chog report token CHOG
chog logout
```

`context` supplies a versioned persona card: canonical NFT identity, name, traits, voice, existing skills, capability descriptions and a freshness timestamp. Optional project-local skill files contain reviewed workflows; MCP tools supply live data. Importing a character does not silently enable every tool or let NFT metadata override the host assistant's instructions.

## Skills for the first release

- Preserve the existing `ask`, `news`, `lookup`, `summarize`, `moderate` identifiers. These are application capabilities; the CLI must distinguish an exported workflow from a working, authorized tool implementation. Moderation actions also require the Discord server's permissions.
- **Monad analysis:** read-only transaction/receipt explanation, address activity, contract inspection and gas summaries. Every result carries chain ID, block number, observation time, provider and explicit gaps. No private keys, approvals, transfers or automated trading in this release.
- **$CHOG reports:** verified token identity plus sourced price/liquidity/volume data when a provider is configured; holder concentration and transfer activity from chain/indexed data; personal credit balance and usage only after owner authentication. Keep City coins and wallet $CHOG separate. Do not invent unavailable price or holder statistics.

Use a shared versioned capability registry for Discord and CLI, with transport adapters around common read services. Start with persona import plus read-only tools; add Discord invocation against that same registry next.

## Charging

Local persona/context use in Codex or Claude Code uses the holder's existing model account. It should not also debit hosted Chog credits. Calls to Chog-hosted AI services can use the existing $CHOG credit ledger only with an explicit price/consent flow and idempotent hold/capture/refund semantics. Reading public context is distinct from paying for a hosted model call; loading a skill file does not itself grant paid service access.

## Build sequence and release checks

1. Extract reusable upstream modules with retained MIT attribution. Create a Chog API adapter and canonical persona/capability schemas; keep mock data usable in development.
2. Add server-issued CLI authentication and epoch-aware access. Test expired/replayed challenges, stale ownership, unavailable RPC, logout, account switching and cross-owner memory isolation.
3. Implement context/selection/local memory and MCP with schema-validated tools. Exercise the actual stdio handshake, malformed input, unknown tools, tool failures and clean stdout.
4. Add Codex and Claude Code setup separately. Test Windows, macOS and Linux config preservation, backup and uninstall behavior; verify each client can load the selected Chog without hosted model spending.
5. Add read-only Monad and $CHOG reports with configured providers, source citations, freshness, rate limits and partial-failure handling. Never make up a report when a provider is unavailable.
6. Connect Discord to the shared capability layer; test guild allowlists, owner settings, server permissions, budget limits and kill switches before enabling public execution.

References: [Codex MCP](https://developers.openai.com/codex/mcp/), [OpenAI skills](https://developers.openai.com/plugins/concepts/skills), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Claude Code skills](https://code.claude.com/docs/en/skills).
