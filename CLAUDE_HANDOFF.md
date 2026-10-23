# Claude handoff: Chog Awakening deployment recovery

Prepared 2026-10-19. Workspace: `C:\Users\THIS-PC\Documents\chogathon`.

## Superseding deployment status — 2026-10-19

**ChogAdapter is now independently verified as deployed on Monad testnet, chain 10143.** Address `0x095FFc29B9b7384763aac703a627Bf8A2D6c7869`, transaction `0xe2a6902c0698d157b48033cfa645666fc02ebe64a5b5743c0ccb2afb52459683`, successful receipt in block `72493203`. The latest local record is `deployments/1792445134988-monad-testnet.json`.

Read-only verification at block `72493456` confirmed the receipt, deployed code and immutable configuration. Evidence: [deployment verification](artifacts/monad-testnet-deployment-verification.json). The adapter points to TestChog `0x9C716801D68b5bDADF7979D37A382a72fDBa1ABE` and identity registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`; the fixture has code and reports ERC-721 support. It is not official Chog Genesis. The old prepared adapter record refers to this same now-confirmed transaction; use the existing adapter.

The remaining recovery narrative is a historical snapshot. Its ambiguous adapter status and source/workflow descriptions are superseded where current files differ; current RPC code includes a `DeploymentProvider` implementation. Deployment confirmation alone does not establish a public awakened identity, a public NFT-transfer proof, an approved City manifest or City implementation. No fresh local test run is claimed by this status update, and no transaction was signed or submitted during verification.

**Current continuation prompt:** Read this status and the verification artifact, then use the existing deployed adapter/fixture. Prepare the public awakening and NFT-transfer demonstration and the City manifest, preserving the ownership/security invariants below. Start with read-only checks of current state and identify any required transactions before execution. The City teammate can independently build fixture Tasks 1–2 from the City plan.

## Start here

The user reports that the deployment issue persists after several fixes and asks for this handoff plus a separate Chog City build plan. Diagnose and reconcile the existing public transactions first. Do not tell the user to rerun the deployment merely because local tests or unsigned preflight pass.

**There are now saved public deployment attempts.** One fixture is recorded as confirmed, an earlier fixture as pending, and the adapter as prepared. These are local records, inspected when writing this handoff; their current onchain state has not been independently verified for this handoff. Earlier chat statements and `docs/progress.md` saying there were zero records or nothing deployed are historical and are superseded by the records below.

No application code was changed, `.env` values read, transaction signed, or public transaction submitted while preparing this file. The latest user message is only “same issue”; there is no new terminal transcript establishing the exact failing RPC method or stage. Do not assume it is still the earlier preflight HTTP 400.

## Historical recovery prompt for Claude — superseded by status above

> Work in `C:\Users\THIS-PC\Documents\chogathon`. Read `CLAUDE_HANDOFF.md`, then inspect the current deployment records and source. First reconcile all three saved transaction hashes on verified Monad testnet chain 10143 using read-only receipt, transaction, nonce, and bytecode queries. A locally prepared transaction can already have been accepted, and a locally pending transaction can already be mined. Do not rerun `deploy:testnet` or create another fixture during initial diagnosis. Identify the exact failing stage/RPC method with redacted diagnostics, reproduce the relevant failure, and make the smallest justified repair with a regression test. Preserve the adapter's ownership and security invariants. Keep `.env`, keys, RPC credentials, and raw signed transactions out of outputs and handoff artifacts. Report observed onchain state separately from local records, a concrete recovery path, and fresh verification evidence. The Chog City teammate can proceed using `docs/superpowers/plans/2026-10-19-chog-city.md` and its matching design spec while deployment recovery is handled separately.

## Existing deployment records: reconcile before any retry

All entries below target chain **10143** and identity registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`. Public deployer address: `0xd0361ECd9fbBa2078ee7936B13B9e32A02775945`. Both records say `officialChogCollection: false`.

### Attempt 1 — `deployments/1792367915624-monad-testnet.json`

| Field | Saved value |
| --- | --- |
| Contract | `TestChog` |
| Nonce | `0` |
| Local status | `pending` |
| Predicted address | `0x27D7Ff61760E752F41D3ABF5D1C70c85fb2326B0` |
| Transaction hash | `0x43dcd53ab985b71246c612b920a436888da1dbc2f295abf0a8598dcfd6683825` |
| Constructor arguments | `[]` |
| Block recorded | None |

This attempt has no saved adapter deployment. Its status may be stale. Do not assume that nonce 0 is still pending or that the predicted address contains deployed code.

### Attempt 2 — `deployments/1792368864007-monad-testnet.json`

| Field | TestChog | ChogAdapter |
| --- | --- | --- |
| Nonce | `1` | `2` |
| Local status | `confirmed` | `prepared` |
| Address | `0x9C716801D68b5bDADF7979D37A382a72fDBa1ABE` | `0x095FFc29B9b7384763aac703a627Bf8A2D6c7869` |
| Transaction hash | `0x1579e3f88575352a7a2aae646d2995c2321ca205e7e079c086054e9bca082083` | `0xe2a6902c0698d157b48033cfa645666fc02ebe64a5b5743c0ccb2afb52459683` |
| Block recorded | `72244796` | None |
| Constructor arguments | `[]` | `["0x9C716801D68b5bDADF7979D37A382a72fDBa1ABE", "0x8004A818BFB912233c491871b3d84c89A494BD9e"]` |

The second record's top-level `collection` is `0x9C716801D68b5bDADF7979D37A382a72fDBa1ABE`. This is the candidate fixture for resuming adapter deployment, subject to fresh receipt and code verification.

### What these status labels mean in this implementation

- `prepared`: an unsigned request was populated, signed locally, its hash/address/nonce calculated, and those public identifiers saved **before** `provider.broadcastTransaction(signed)` was called. A failure after that save can leave this status even if the endpoint accepted or mined the transaction.
- `pending`: `broadcastTransaction` returned its response object and the status was saved, but receipt waiting had not completed successfully. It is not a live statement about the mempool.
- `confirmed`: `transaction.wait(1, 120_000)` returned and the block number was saved. Independently re-query the receipt and code before treating this as today's verified chain state.
- The record contains neither raw signed bytes nor all populated transaction fields/fees. Its hash alone is insufficient to reconstruct identical signed bytes for a rebroadcast.

If nonce 1 is freshly verified as mined, nonce 0 must have been consumed first for this EOA. That still does not prove the recorded nonce-0 hash was the transaction that consumed it; check the hash and any replacement explicitly. Never resolve ambiguity by starting another fixture deployment.

## Recovery checklist

1. Preserve both JSON records and the existing source/artifact state. Do not overwrite them with guessed statuses. Check for any newer records before proceeding.
2. Independently probe endpoint `eth_chainId`; require `0x279f` / decimal 10143 before reading or signing. Do not trust a URL name or static provider configuration alone.
3. For **each** saved hash read `eth_getTransactionReceipt` and `eth_getTransactionByHash`; capture endpoint hostname, checked time, chain ID, block, receipt status, contract address, sender and nonce. Use another independently verified endpoint for inconsistent or null results. A null result from one failing/public RPC is not proof that a transaction was never sent.
4. Read sender transaction counts at both `latest` and `pending`. Compare against nonces 0, 1 and 2. If a nonce is consumed but the saved hash is missing, investigate a replacement and its actual outcome rather than submitting anew.
5. Read bytecode at all three predicted addresses. For the chosen fixture check `supportsInterface(0x80ac58cd)` and optional `name()`, with bounded gas as in the existing checker. For any deployed adapter read `collection()` and `identityRegistry()` and compare the immutable constructor configuration. Existence of arbitrary code alone is not enough; compare expected artifacts/constructor results as appropriate.
6. Determine whether the adapter's nonce-2 transaction succeeded, reverted, remains pending, was replaced, or cannot yet be resolved. A reverted creation consumes its nonce; a timeout does not establish a revert.
7. If the adapter is already deployed correctly, recover/record it and verify its behavior instead of deploying another one. If it is pending, monitor/reconcile that hash. If state remains ambiguous, complete read-only diagnostics before a resubmission/replacement decision.
8. If a new adapter deployment is actually needed, reuse a freshly verified existing fixture. Setting only `CHOG_COLLECTION_ADDRESS` to that fixture makes the existing script plan **adapter only**. Do not change the key or assume the current `.env` collection already matches the record. Preserve other `.env` bytes and do not print the file.
9. Capture the failing stage and RPC method using safe diagnostics. A full live path includes second-contract preparation, submission, and receipt polling after the first contract; passing first-contract preflight does not validate these later steps.
10. Run the regression(s) and relevant local tests. Before a further user-facing retry instruction, explain exactly what was observed and fixed, how existing transactions were reconciled, and which uncertainty remains. A successful unsigned preflight supports “preflight passed,” not “public deployment is confirmed.”

Initial reconciliation needs no signing key: the sender, hashes, addresses and registry are all public above. Use read-only provider methods. For initial diagnosis, do not call `signTransaction`, `broadcastTransaction`, `sendTransaction`, `eth_sendRawTransaction`, or the broadcast command.

## Current deployment and RPC workflow

### Configuration

`scripts/deployment-config.mjs` fixes deployment to testnet chain 10143 and the registry above. `CHOG_COLLECTION_ADDRESS` is optional: empty means deploy a **new** labelled `TestChog` and then `ChogAdapter`; set means validate the selected collection and deploy only the adapter. **The script is not resumable/idempotent across separate runs.** It does not load previous records and skip completed contracts. Leaving collection empty after one fixture has succeeded can deploy another fixture.

Known public RPCs: `https://monad-testnet.drpc.org`, `https://rpc.ankr.com/monad_testnet`, `https://testnet-rpc.monad.xyz`. A known public primary gets the others as setup/preflight fallbacks. A custom/private RPC remains exclusive. Do not move private URL credentials to other hosts. `.env.example` defaults to the official endpoint; prior work changed the local primary to dRPC. Current `.env` values were deliberately not read for this handoff and must not be inferred from the example.

Environment variable names:

| Name | Purpose |
| --- | --- |
| `MONAD_TESTNET_RPC_URL` | Selected public/custom testnet endpoint |
| `CHOG_COLLECTION_ADDRESS` | Optional real ERC-721 on the current testnet; empty deploys a fixture |
| `DEPLOYER_PRIVATE_KEY` | Local disposable testnet signer; never share its value |
| `MONAD_MAINNET_RPC_URL` | Optional mainnet read-check override; not a mainnet deployment switch |

### `scripts/deploy.mjs`

1. Loads `.env` if present and derives configuration. No flags means print offline plan and exit; `--preflight` performs unsigned live checks; `--broadcast` performs deployment. Those two flags are mutually exclusive.
2. Live modes construct an account from the local key. The unsigned preflight path does **not** sign or broadcast, although it currently requires a configured valid key to obtain the account.
3. For each candidate endpoint, performs actual-chain probe, registry code/ERC-721 checks, selected collection checks if applicable, balance, first-contract gas estimation, nonce and fees. Uses `NonceManager`. Zero/insufficient funding and wrong-chain failures stop instead of trying to evade the condition through another endpoint.
4. Picks the provider only after that unsigned preflight completes. Reuses the first populated request so it is not re-estimated before signing. `--preflight` then exits with no transaction signature or broadcast.
5. In broadcast mode writes a new timestamped `deployments/*-monad-testnet.json` through callbacks. Runs fixture first if collection is unset, then the adapter. No automatic submission retry or endpoint failover happens after selection.
6. Catches the final error and prints only `error.shortMessage ?? error.message`. This can hide nested cause/stage. Add narrowly scoped, sanitized trace evidence as needed; do not dump full ethers errors, environment, request headers, raw transactions, or RPC URL paths/query strings.

### `scripts/deploy-contract.mjs`

`prepareDeployment` builds constructor calldata, estimates with an explicit 8,000,000 gas **simulation ceiling**, then populates using the **returned estimate** as the transaction gas limit. `deployAndRecord` signs, persists hash/address/nonce as prepared, increments a managed nonce if present, calls `provider.broadcastTransaction`, persists pending, then waits for one confirmation with a 120-second timeout and persists confirmed.

The second deployment is prepared only **after** the first finishes. Its gas estimation, fee/nonce population, constructor ERC-165 calls, submission, and receipt reads are distinct failure opportunities outside the first preflight.

### `scripts/rpc.mjs`

Owned native Node HTTP(S) transports use keep-alive agents with `maxSockets: 1`; requests have hard deadlines that destroy timed-out sockets. Shutdown destroys active/idle sockets, including sockets released after a queued-request race. Request bodies and gzip output are bounded at 4 MiB. Plaintext URL credentials are rejected. HTTP errors are not redirected/retried automatically. A raw `eth_chainId` response is envelope-validated before constructing ethers `JsonRpcProvider` with `staticNetwork: true`, `batchMaxCount: 1`, and disabled read caching.

Startup probes have at most a five-second timeout per candidate; normal requests default to ten seconds. Preflight failures can move to the next known public endpoint **before signing**. Wrong-chain or explicit `PREFLIGHT_REJECTED` failures stop. Error labels include a validated RPC method/hostname, not request params. Endpoint exhaustion currently aggregates host/method names while discarding detailed causes. `check:monad` uses setup fallback but does not perform the complete deployment preflight during endpoint selection.

## Failures already encountered and changes already tried

Treat these as history, not proof that the user's live issue is solved:

| Failure/evidence | Change already in source |
| --- | --- |
| User pasted literal Markdown fence text such as three backticks plus `powershell` | README says copy only commands; use inline commands for user-facing next steps |
| PowerShell resolved `npm` to blocked `npm.ps1` | Use `npm.cmd`; no execution-policy change needed |
| A local demo collection address was supplied for public testnet; ABI decode failed | Cleared that stale collection then; checker now verifies code before ABI calls and treats `name()` as optional |
| Network detection repeated and timeouts left sockets alive | Actual-chain probe, static provider after verification, owned transport, hard deadline/cleanup |
| dRPC preflight `missing revert data`; nested cause `user-specified gas exceeds provider limit` | Explicit 100,000 gas on read-only ERC-165/metadata calls; bounded 8-million gas deployment estimation, returned estimate used on transaction |
| HTTP 400 / method unavailable for `eth_gasPrice` was inconsistent across fresh connections | Connection reuse, unsigned first-deployment preparation before provider selection, fallback during preflight |
| Receipt retrieval failed after an accepted/mined transaction, losing recovery information | Persist public hash/nonce/predicted address before broadcast, then pending/confirmed statuses |
| Agent closure plus queued request left a socket alive | Regression plus agent `free` cleanup after closure |

The last supplied screenshot before “same issue” ended with `RPC monad-testnet.drpc.org returned HTTP 400; requests are not retried or redirected.` That screenshot is older than the current local records. The newest exact error/method is not available. Later evidence proves the current situation progressed beyond the old zero-record preflight failures.

## What the existing tests establish, and what they do not

The **last recorded** full Node suite result is **45/45 passing** with no failures/skips. This result is from prior work, not a fresh test execution while writing this handoff. The source currently contains 45 top-level tests: adapter 9, collection checking 5, deployment configuration 4, deployment helper 7, RPC 20.

Tests use an isolated local Hardhat EVM with the actual pinned registry implementation and real local HTTP servers. They cover NFT ownership transfer, identity custody, zero IDs, authorization and reserved metadata, hostile registry rollback/reentrancy, gas caps, preparation without signing, managed nonce progression, hashes surviving lost submission/receipt responses, transport cleanup/deadlines, malformed probes, response limits, connection reuse, and preflight fallback.

They do not establish successful public Monad submission or receipt availability. They do not yet provide a complete cross-process recovery test that loads a previous public record, reconciles nonce/hash, reuses a confirmed fixture and resumes adapter deployment. A healthy TestChog preflight does not exercise a public adapter submission. Fresh second-contract estimation, method-specific provider errors after successful preflight, ambiguous nonce replacement, differing endpoint visibility, and fee/nonces changing between preparation and submission are areas to investigate from evidence. These are suspected failure paths, not diagnosed causes of the newest report.

The last recorded live unsigned preflight selected Ankr and estimated TestChog at 837,024 gas, then exited without signing. An older saved read-check at `artifacts/monad-testnet-check.json` records Ankr, chain 10143, block 72233672, registry bytecode 130 bytes, and `collection: null`. Neither artifact proves today's full deployment state.

## Commands and their effects

Run from `C:\Users\THIS-PC\Documents\chogathon` in PowerShell. Copy command text only; do not paste Markdown fence markers.

| Command | Effect |
| --- | --- |
| `node --version` / `npm.cmd --version` | Local runtime inspection |
| `npm.cmd ci` | Installs exact lockfile dependencies; mutates local dependencies/cache; package network access |
| `npm.cmd run compile` | Compiles locally and rewrites `artifacts/compiled.json`; no chain transaction |
| `node --test --test-concurrency=1 test/*.test.mjs` | Runs tests against existing artifacts/local fixtures; no public-chain signing |
| `npm.cmd test` | Recompiles, then runs the complete suite |
| `npm.cmd run demo` | Recompiles and runs an isolated local EVM demo; writes local-only receipt artifact |
| `npm.cmd run deploy:plan` | Recompiles and prints an offline unsigned plan; no key needed |
| `node scripts/deploy.mjs --preflight` | Live read/estimate preparation; key currently required locally but no signing/broadcast; not a transaction-recovery check |
| `npm.cmd run check:monad -- --testnet` | Public testnet read check; writes a success artifact; not full deployment/recovery verification |
| `npm.cmd run check:monad` | Public **mainnet read only** provenance check |
| `npm.cmd run deploy:testnet` | **Signs and broadcasts**; do not use as a diagnostic retry before reconciliation |

Local HTTP tests previously needed permission outside the sandbox because loopback socket creation was blocked under restricted execution. That was an environment constraint, not a failing assertion. Compilation can take over a minute. Do not repeatedly recompile unchanged Solidity while diagnosing only JavaScript transport behavior.

## Contract guarantees and project boundary

Chog Awakening is the existing local proof for Chog World Order: an existing ERC-721 controls a persistent ERC-8004 identity. This workspace contains contracts and scripts, not a City frontend, production backend, inference runtime or wallet-delegation implementation.

- `ChogAdapter` is non-upgradeable with immutable ERC-721 collection and identity registry addresses; no administrator, rebinding, arbitrary execution or withdrawal surface.
- Only the **current NFT owner** may awaken or manage; an approved NFT operator does not gain agent-management rights. Management checks live `ownerOf` on each call, so transfer immediately changes onchain control.
- Each NFT awakens once per adapter, including valid token/agent ID zero. The adapter owns the registry identity NFT; the original collection NFT remains with its owner.
- Binding is immutable. The registry metadata key `agent-binding` contains the adapter's raw 20-byte address. `agent-binding` and `agentWallet` cannot be written through ordinary metadata management.
- Awakening validates the expected safe-mint callback/custody and clears the registry's default payment wallet. Reentrancy and malformed registration revert. There is **no funded or delegated agent wallet** in this milestone.
- Direct safe transfers/unsolicited callbacks are rejected; unsafe `transferFrom` can bypass receiver checks and has no recovery path. Do not use the adapter as an NFT custody vault.
- NFT transfer does not revoke offchain sessions, memory, Discord credentials or other application permissions. City/runtime ownership checks must implement that separately.
- The ERC-8217 discovery shape is used, but this adapter is **not established as Monad's canonical ERC-8217 binding singleton**, and no full compliance/designation claim is made.

Public state-changing entry points: `awaken(uint256,string)`, `setAgentURI(uint256,string)`, `setMetadata(uint256,string,bytes)`. Discovery reads: `agentOf(uint256)`, `bindingOf(uint256)` returning enum/collection/token ID, `controllerOf(uint256)`, plus immutable getters `collection()` and `identityRegistry()`.

`TestChog` is deliberately an unrestricted-mint fixture labelled “Chog Awakening Test NFT” / `TESTCHOG`; it is not official Chog Genesis or production collection logic. No public awakening/NFT-transfer demonstration has been established by the saved deployment JSON files.

## Source pins and network identities

| Item | Value / evidence |
| --- | --- |
| Monad testnet | Chain 10143 (`0x279f`) |
| Testnet identity registry | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Monad mainnet | Chain 143 (`0x8f`); read-only in the prepared scripts |
| Mainnet identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Authentic mainnet Chog Genesis | `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763`; provenance documented from official Chog links, OpenSea, MonadScan, and successful read calls |
| Official current-testnet Genesis | Not verified; historical pre-reset listings are insufficient |
| Registry source | `erc-8004/erc-8004-contracts` commit `b9e466c250744a7e06b13dff9d3c2844ed64f825`; implementation version 2.0.0 |
| Compiler | solc 0.8.24, optimizer 200, viaIR, Shanghai |
| Locked packages | `ethers` 6.17.0, `hardhat` 3.20.0, `solc` 0.8.24, both OpenZeppelin packages 5.4.0 |
| Runtime | Node >=24; prior host observation Node 24.19.0, npm 11.17.0 |

Read `docs/provenance.md` for source URLs, SHA-256 hashes, licensing notices, collection evidence and discovery caveats. Treat those observations as dated evidence; verify live network state independently. The local registry fixture uses upstream `HardhatMinimalUUPS`, proxy bootstrap and an upgrade to the real identity implementation; it is not a replacement public registry.

## File map

Paths below are relative to the workspace named at the top.

| File / directory | Role |
| --- | --- |
| `contracts/ChogAdapter.sol` | Ownership-bound identity contract |
| `contracts/interfaces/{IAgentBindings,IIdentityRegistry}.sol` | Discovery and upstream integration interfaces |
| `contracts/test/{TestChog,FaultyRegistry}.sol` | Labelled fixture and adversarial test registry |
| `contracts/vendor/erc8004/` | Three pinned, unchanged upstream MIT files |
| `scripts/compile.mjs`, `scripts/artifacts.mjs` | Compile/load artifacts |
| `scripts/deploy.mjs`, `scripts/deploy-contract.mjs` | CLI orchestration; transaction preparation and persistence |
| `scripts/deployment-config.mjs` | Network/collection validation and plan |
| `scripts/rpc.mjs` | Owned transport, verified provider, unsigned setup/preflight fallback |
| `scripts/check-monad.mjs`, `scripts/collection-check.mjs` | Public read check and safe ERC-721 inspection |
| `scripts/demo.mjs` | Local proof demonstration |
| `test/{adapter,collection-check,deployment,deploy-contract,rpc}.test.mjs` | Existing 45 tests |
| `test/helpers.mjs`, `hardhat.config.js` | Isolated local EVM and real registry fixtures |
| `artifacts/compiled.json` | Compiler input, ABI, creation/runtime bytecode and metadata; preserve for comparison |
| `artifacts/local-demo.json` | Local simulated receipt summary; never public deployment evidence |
| `deployments/*-monad-testnet.json` | Actual attempted public deployment recovery records above |
| `docs/provenance.md` | Dated source/chain provenance |
| `docs/progress.md` | Historical chronology; its last zero-record statement is stale |
| `docs/superpowers/specs/2026-10-18-chog-awakening-design.md` | Existing contract scope and invariants; older signer wording is historical |
| `docs/superpowers/plans/2026-10-18-chog-awakening.md` | Completed local proof plan |
| `docs/superpowers/specs/2026-10-19-chog-city-design.md` | Separate City product/design handoff |
| `docs/superpowers/plans/2026-10-19-chog-city.md` | Separate teammate implementation plan; start there for City |

The workspace has no `.git` directory as inspected for this handoff. `.gitignore` excludes `.env`, `.env.*` except `.env.example`, dependencies/cache/artifacts and deployment JSON except an example. That exclusion does not erase the files: preserve/share **public** records deliberately when handing off. Do not put the secret `.env` into a repository, zip, chat or teammate packet. Use `.env.example` to document variable names and let each operator configure their own signer locally.

## Requested outcome for the next operator

Produce (1) a fresh public transaction reconciliation, (2) exact root-cause evidence with method/stage and secrets redacted, (3) a justified repair or safe resume path that reuses an existing fixture, and (4) fresh tests plus live read/unsigned verification. Distinguish that from actual successful adapter deployment and the later public ownership-transfer proof. The City teammate should not wait on RPC reliability to begin the separately planned mock/local build.
