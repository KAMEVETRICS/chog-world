# Local Chog CLI

Take an awakened Chog Genesis persona into Codex or Claude Code. Persona generation, wallet proof, saved context, memory and MCP run on your computer. **No Chog World server, hosted model API key or $CHOG payment is required.**

This is a repository-installable first release, not a published npm package. Node.js **24+** is required. Supports Monad mainnet and EOA browser wallets initially. An imported token must already be awakened through the reviewed Chog adapter; this CLI never awakens a token or submits a transaction.

## Start from this repository

PowerShell, from the repository root:

```powershell
npm.cmd --prefix cli ci
node cli/bin/chog.js --help
node cli/bin/chog.js login
node cli/bin/chog.js import 42
node cli/bin/chog.js context
```

Replace `42` with your token ID. Login opens a temporary `127.0.0.1` page in your browser. Choose your wallet and sign the local login message. The signature is verified locally and is never saved; no transaction, wallet key or server credential is involved. Wallet proof lasts one hour. To open the page yourself, run `login --no-open` and use the URL printed in the terminal.

Import verifies the holder, adapter bytecode, collection/registry and the NFT's agent binding at a finalized Monad block. It reads traits from the collection's `tokenURI` (HTTPS, IPFS or JSON data URI), and uses the same deterministic character rules as Soul. The generated name is `Chog #<id>`, matching the live chain directory; server-only nicknames/private instructions are not imported. External metadata and RPC providers remain external dependencies. Import fails clearly if a token is not awakened or a provider is unavailable.

If the metadata provider is unavailable, explicitly supply a small NFT metadata JSON file containing `attributes`:

```powershell
node cli/bin/chog.js import 42 --metadata-file .\my-chog-metadata.json
```

The result labels traits as user-supplied. This does not bypass wallet or on-chain identity checks. Neither trait metadata nor character speech grants instructions or permissions to the assistant.

## Use it in your coding assistant

```powershell
node cli/bin/chog.js setup codex
node cli/bin/chog.js setup claude-code
```

Each prints a native MCP registration command with your absolute Node and CLI paths. Review and run the command for your client. `setup` itself changes no client configuration and never edits `AGENTS.md` or `CLAUDE.md`. Windows output is quoted for PowerShell; macOS/Linux output is quoted for a POSIX shell. Keep this checkout at its installed path after registration.

After registration, open/restart the client as needed and ask:

> Load my Chog persona with `chog_persona_context`, then use its voice while helping with this project.

For a saved public character without ownership/network checks:

> Load `chog_offline_persona`. Treat it as a saved character, not proof of current ownership.

MCP uses the host assistant's model account. The CLI runs no hosted model and debits no Chog credits. The host may send tool output to its model provider; include private memories only when you intend to share them with that assistant.

To remove registration, use the client's native command: `codex mcp remove chog` or `claude mcp remove --scope user chog`. This does not delete your local persona/memories.

## Offline persona and explicit local memory

```powershell
node cli/bin/chog.js context --offline
node cli/bin/chog.js context --out .\chog-public-persona.json
node cli/bin/chog.js memory add "I prefer concise answers with working commands."
node cli/bin/chog.js memory list
node cli/bin/chog.js memory export --out .\my-private-memories.json
node cli/bin/chog.js memory clear --confirm
node cli/bin/chog.js logout
```

Public context export works offline, omits wallet proof and private memories, labels itself a dated copy and refuses to overwrite files. Local memories are saved only on request; there is no automatic chat logging. Memory entries are limited to 2,000 characters, normal reads return the latest 20, and explicit export includes all entries for the current scope.

Live context/memory operations check current ownership directly on Monad, using finalized blocks and incremental ERC-721 Transfer logs. A sale followed by reacquisition, a checkpoint reorg or a verification gap over 10,000 blocks requires re-import with a fresh local generation. A transient provider error blocks the operation but retains the checkpoint for retry. This is a local ownership generation, **not the Chog World server's epoch**. Re-import always starts a fresh memory namespace; it does not delete earlier records. Renewing login with the same wallet retains selection, subject to fresh ownership checks. Switching wallets or logging out clears active selection.

No software can revoke an exported persona or erase a seller's saved files. The local checks prevent accidental cross-account/history sharing through these tools; they are not DRM against someone who controls their own computer.

Data defaults to `~/.chog/chog.db`. It is local SQLite, **not encrypted**. POSIX uses private directory/file modes; on Windows the files inherit your OS account's directory ACLs. Protect your OS account, backups and any memory exports. Logout forgets the active proof/selection but retains the public persona and memory database. Explicit `memory clear` deletes only the current verified generation's memories, not all historical records.

## Skills and reports

```powershell
node cli/bin/chog.js skills list
node cli/bin/chog.js report transaction 0xYOUR_TRANSACTION_HASH
node cli/bin/chog.js report token 0xYOUR_WALLET_ADDRESS
```

The original five IDs remain: `ask`, `news`, `lookup`, `summarize`, `moderate`. Ask/summarize/moderate are host-model workflows, not independent models or Discord permissions. Village news is explicitly unavailable without optional City connectivity; no City server request is made. Lookup reads holder/awakened identity information from Monad.

Additional working tools:

- `chog_transaction`: public Monad transaction and receipt, observation time, finalized reference block and finality by block height.
- `chog_token_report`: public $CHOG wallet balance and total supply at a pinned finalized block.

The token report uses chain 143 and `$CHOG` contract `0x350035555e10d9afaf1566aaebfced5ba6c27777`. It provides no market price, volume, liquidity, holder concentration, City coins or hosted credit balance. Market data and Discord transport remain follow-up work.

All ten MCP tools are discoverable through your client's MCP tools view. Memory add/clear are local writes, with explicit consent descriptions; there are no transaction, trading, payment or remote-mutation tools.

## Configuration and verification

```powershell
$env:CHOG_HOME = "$env:USERPROFILE\.chog"
$env:CHOG_RPC_URL = "https://rpc.monad.xyz"
npm.cmd --prefix cli test
```

The default RPC is public and rate-limited; you may choose another HTTPS Monad RPC. HTTP is allowed only for explicit localhost development. The client checks chain ID 143, bounds responses/timeouts and rejects redirects and write RPC methods. Do not put provider credentials in a URL; treat provider API-key URLs as secrets if using a provider that requires them. `setup` includes configured environment values in its printed command, so review it locally and do not paste private provider URLs into public chats.

RPC providers observe requested public addresses/tokens; metadata providers observe NFT metadata requests. The CLI never loads the repository root `.env`. It contacts no Chog World API and requires no production deployment. Tests use generated, unfunded wallets and local fixtures; the persona parity test reads the repository's Soul source and uses the CLI's own development dependencies. The npm package allowlist excludes tests, databases and runtime state.

References: [Codex MCP](https://developers.openai.com/codex/mcp/), [Claude Code MCP](https://code.claude.com/docs/en/mcp), [Monad RPC](https://docs.monad.xyz/reference/json-rpc/overview), [MCP SDK](https://modelcontextprotocol.io/docs/develop/build-server).
