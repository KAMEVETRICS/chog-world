# Chog local core — execution plan

Approved direction: local core, following the user's choice on 2026-10-22. This supersedes the server-dependent foundation plan. No Chog World authentication, backend migration or deployment is required.

1. [x] Standalone Node >=24 package: direct read-only Monad RPC, verified deployment constants, bounded metadata reads and deterministic persona matching Soul. Write tests before modules.
2. [x] Local wallet proof through a loopback browser, exact-message EOA signature verification, private local session storage. No transactions or wallet keys. Test Host/Origin/state, replay, expiry and cleanup.
3. [x] Import/select a token held by that wallet; verify collection, adapter, registry and binding at a finalized block. Save a public persona card locally. The default profile names the NFT as `Chog #<id>`, matching the live directory, and derives traits from collection metadata.
4. [x] Explicit local memory scoped to wallet + canonical identity + local ownership generation. Revalidate ownership before live context/memory operations. Scan incremental Transfer logs since the last checkpoint; on transfer, reorg or an excessive/unverifiable gap, require re-import with a fresh generation. Do not claim a server's global epoch or revocable offline copies.
5. [x] SDK-based MCP tools and safely quoted native setup commands for Codex and Claude Code. Public offline context works without wallet/RPC; private memory remains separate. No automatic client configuration writes.
6. [x] Preserve five existing skill IDs as workflows; distinguish unavailable village news from local workflows and working read-only chain tools. Add basic transaction and $CHOG on-chain reports without market-price claims or paid services.
7. [x] Verify unit/integration tests including real SDK stdio calls, persona parity with Soul, package allowlist and live read-only RPC smoke checks. Review code, document commands, commit and push. No npm publication or AWS changes.

Privacy: local files are owned by the OS user, not encrypted DRM. Switching NFT holders must not automatically share history. RPC providers can observe requested addresses; metadata providers can observe NFT lookups. Hosted assistant/model services still process whatever the user elects to supply.

Limits: imported public context can be used offline but is not proof of current ownership. An ownership cache is never used to authorize live private-memory reads after a failed RPC check. Wallet proof supports EOA signatures initially. Users can supply a metadata JSON file explicitly if their NFT metadata provider is unavailable; provenance is labeled. No file URL or arbitrary network fetch is exposed as an MCP tool.

Onboarding correction: the user explicitly requires the Normies flow. Implemented automatic owned-NFT discovery and a browser picker during login; no token-ID knowledge or separate import step is required. Discovery is direct RPC and profile traits/artwork use the bundled City snapshot. A single eligible Chog is automatic; multiple eligible Chogs are chosen by artwork/name. Signed-session discovery retries avoid a second signature.
