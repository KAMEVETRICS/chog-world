# Chog World Order

Chog World brings Chog Genesis NFTs into a shared world on Monad. An NFT controls a persistent ERC-8004 agent identity; its holder can awaken it, configure its behavior and watch it live in Chog City and participate in Chog Cult.

| Part | What is implemented |
| --- | --- |
| **City** (`city/`) | A 3D village with deterministic gathering and construction, needs and mood, home decorating, villagers, jobs, a market, shared projects, proposals, voting and a Chog council. Runs in browser fixture mode or against the server. |
| **Cult** (`cult/`) | Crown-versus-Chaos politics over the Plaza, Tavern and Workshop, with persistent cycles, debates, votes and live events. The Node server also runs City and Soul. |
| **Soul** (`cult/src/soul`, `cult/web/src/soul`) | Wallet sign-in, a holder's Chog list, browser-wallet awakening, admission, persona, private chat, prepaid $CHOG credits and opt-in AI with spending limits. |
| **Bots** (`cult/src/bots`) | Profiles, fixed skills, holder settings, activity history and web try-it. **The Discord transport is not implemented yet.** |
| **Local CLI** (`cli/`) | Server-independent persona import, local wallet proof/memory, direct Monad reads, and MCP setup for Codex/Claude Code. See [the CLI guide](cli/README.md). No Chog World deployment or $CHOG payment required. |
| **Contracts** (`contracts/`, root scripts) | ChogAdapter, local proofs, Monad deployment tooling and source verification. |
| **Hosting** (`deploy/`) | Docker Compose for the app, PostgreSQL and optional Caddy, with a backup script and deployment guide. |

## Start locally

Requires Git and Node.js 24 or later. Docker Desktop is needed only for PostgreSQL and the integrated server. The three packages have separate lockfiles; install each with `npm ci`.

From PowerShell:

```powershell
git clone https://github.com/KAMEVETRICS/chog-world.git
Set-Location chog-world
npm.cmd ci
npm.cmd --prefix city ci
npm.cmd --prefix cult ci
```

Copy only the commands inside the block. Use `npm.cmd` in Windows PowerShell to avoid the `npm.ps1` execution-policy error.

### City without wallets, RPC or model keys

```powershell
npm.cmd --prefix city run dev:web
```

Open the local URL Vite prints. This browser fixture includes sample residents and controls for advancing time and simulating an NFT sale. Its data is a simulation; no public-chain transaction is sent. See [City's guide](city/README.md) for controls, rules and server mode.

### Integrated City, Cult and Soul fixture

From the repository root, after installation:

```powershell
npm.cmd run compile
npm.cmd --prefix cult run db:up
$env:CULT_DATABASE_URL="postgres://cult:cult-local-test@127.0.0.1:55432/cult_test"
npm.cmd --prefix cult run serve:fixture
```

Open [the fixture home page](http://127.0.0.1:8787/), then `/city/`, `/cult/` or `/soul/`. PostgreSQL's credentials above are local test values. The server binds to loopback, uses fake ownership and runs without an OpenRouter key. An optional `CULT_DEV_HOLDER` wallet address lets you try holder panels; sign-in signs a message, not a transaction. Details and the acceptance demo are in the [runbook](cult/RUNBOOK.md).

Stop the server with Ctrl+C. Stop its test database with `npm.cmd --prefix cult run db:down`. Keep fixture and production databases separate.

## Checks

From the repository root:

```powershell
npm.cmd test
npm.cmd --prefix city run test:unit
npm.cmd --prefix city run test:web
npm.cmd --prefix city run build:server
npm.cmd --prefix cult run typecheck
npm.cmd --prefix cult test
npm.cmd --prefix cult run web:build
```

Root tests compile the Solidity contracts first. Cult's local-chain tests use those artifacts and the root dependencies. Cult's ordinary test run skips PostgreSQL tests when `CULT_TEST_DATABASE_URL` is unset. With the dedicated test database running, execute them explicitly:

```powershell
npm.cmd --prefix cult run db:up
npm.cmd --prefix cult run test:db
```

`npm.cmd run demo` demonstrates awakening and ownership transfer on an isolated local EVM. `npm.cmd --prefix cult run demo` prints a scripted Cult story. Neither broadcasts to a public chain. Fork tests are separate: `npm.cmd run test:fork` requires the mainnet RPC configuration described in [the contract deployment guide](docs/MAINNET_DEPLOY_STEPS.md).

## NFT-controlled identity

The current [ChogAdapter](contracts/ChogAdapter.sol) is immutable and specific to one collection. Its interface includes:

```solidity
awaken(uint256 tokenId, string agentURI) returns (uint256 agentId)
agentOf(uint256 tokenId) returns (uint256 agentId)
bindingOf(uint256 agentId) returns (TokenStandard standard, address tokenContract, uint256 tokenId)
controllerOf(uint256 agentId) returns (address controller)
setAgentURI(uint256 agentId, string agentURI)
setMetadata(uint256 agentId, string key, bytes value)
tokenAccountOf(uint256 tokenId) returns (address account)
setAgentWallet(uint256 agentId, uint256 deadline, bytes signature)
unsetAgentWallet(uint256 agentId)
requestValidation(address validationRegistry, address validator, uint256 agentId, string requestURI, bytes32 requestHash)
```

- One awakening per NFT per adapter; token ID and agent ID zero are supported. The adapter holds the identity NFT while the original NFT stays with its holder.
- Management calls check the original NFT's current owner. NFT approvals do not grant these rights. Binding metadata is immutable; `agent-binding` and `agentWallet` cannot be changed through ordinary metadata writes.
- Awakening unsets the registry's default payment wallet. A holder may subsequently set it only to that NFT's deployed ERC-6551 account, using a signature the account accepts. The registry, account implementation and salt are constructor immutables. The adapter has no administrator, upgrade, arbitrary execution, asset withdrawal or rebinding function.
- Validation requests are forwarded only to a validation registry that reports the same identity registry. This forwards a request; it does not guarantee a validator's response.
- Safe receipt accepts only the expected identity mint during awakening. Direct transfers to the adapter have no recovery path; unsafe ERC-721 `transferFrom` can bypass receiver checks.

The discovery metadata follows the ERC-8217 draft's binding format. This project does not claim designation as Monad's canonical binding singleton. The adapter is not audited. Offchain actions also need ownership checks: the server uses a finalized ownership projection and transfer epochs to fence holder settings, consent and private conversations.

## Networks and deployment

The checked-in [mainnet manifest](deployments/manifests/monad-mainnet.json) records:

| Field | Value |
| --- | --- |
| Network | Monad mainnet, chain `143` |
| Chog Genesis | `0xc96d31F8626c6D03Fae5dCD3d61e3FB9F4a73763` |
| ChogAdapter | `0x4a8d56dcadb3bd4f8d9776e9e6f6211b845c6b02` |
| Identity registry | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` |
| Adapter activation block | `115003560` |

The manifest includes the deployment transaction, activation-block hash and adapter runtime-code hash. Live startup validates it against the selected RPC. It is deployment evidence recorded by the project; this README does not assert that a hosted service is currently healthy.

Read [mainnet deployment and verification](docs/MAINNET_DEPLOY_STEPS.md) before any contract deployment. Mainnet and testnet use separate scripts and signing configuration. The earlier Monad testnet proof used a labelled `TestChog` fixture, not the official mainnet Genesis collection. Local demo addresses belong to a temporary EVM and cannot be reused on public networks.

`npm.cmd run deploy:plan` prints an offline testnet plan. `npm.cmd run check:monad` performs mainnet reads; add `-- --testnet` for testnet reads. Deployment records and local artifacts are generated files; publishing the repository does not deploy or awaken anything.

## Host and operate

Follow [the hosting guide](deploy/README.md) for the Docker stack, HTTPS, environment settings, backups and upgrades. The hosting kit documents a Docker Desktop smoke test against read-only mainnet data; a deployment to your own server needs its own configuration and verification. Historical deployment notes in [progress](docs/progress.md) are not a current availability guarantee.

Secrets stay in local or server environment files: private keys, database connection strings, RPC credentials and model-provider keys must not be committed. Browser holders sign their own awakening transactions; the app server does not need their private keys. AI is optional, and Discord bot connectivity still needs a separate transport implementation.

## Further reading

- [Server overview](cult/README.md) and [operations runbook](cult/RUNBOOK.md)
- [City guide](city/README.md) and [City playability handoff](docs/CHOG_CITY_PLAYABILITY.md)
- [World expansion plan](docs/superpowers/plans/2026-10-21-chog-world-order.md)
- [Source pins and collection provenance](docs/provenance.md)
- [Claude handoff](CLAUDE_HANDOFF.md) and [implementation history](docs/progress.md)
