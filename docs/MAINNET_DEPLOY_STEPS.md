# Mainnet deployment: steps for tomorrow

Deploys the ChogAdapter to Monad mainnet (chain 143), bound to the real Chog Genesis, the ERC-8004
identity registry, and Tokenbound. Run everything in PowerShell from
`C:\Users\THIS-PC\Documents\chogathon`. Copy only the command lines, not the backtick fences.

Before you start: the code was last tested on 2026-10-19 (64/64 local tests, 2/2 mainnet-fork tests).
Expected adapter init code hash in the plan: `0xea7b8dd44ebbe8a6082857994a63b652fff0b210b02364f1c70590d965820c5d`.

## 1. Create and fund a fresh mainnet wallet

- Make a **new** wallet just for this deployment. Do not reuse the testnet deployer
  (`0xd036…5945`); the script refuses it.
- Send it about **0.3 MON**. The 2026-10-19 preflight estimated 0.252 MON, and Monad charges the
  full gas limit. The deployment is a single transaction.

## 2. Add it to `.env`

Open `.env` in a text editor and add these lines (see `.env.example`). Never paste the key into chat.

```
MAINNET_DEPLOYER_ADDRESS=<your new wallet address>
MAINNET_DEPLOYER_PRIVATE_KEY=<its private key>
MONADSCAN_API_KEY=<optional: an Etherscan API key, to also publish on MonadScan>
```

## 3. Check the plan offline (no network, no key)

```
npm.cmd run deploy:mainnet
```

Check that `adapterInitCodeHash` matches the hash above and that the only action is `ChogAdapter`.

## 4. Run the preflight (signs nothing)

```
npm.cmd run deploy:mainnet -- --preflight
```

It checks the chain, Chog Genesis, the registry version and pinned implementation, Tokenbound, gas,
nonce, fees and your balance, and simulates the deployment. It ends with a code like `CHOG-1A2B3C4D`.

If it says **"The identity registry was upgraded"**, stop: the ERC-8004 team changed the registry and
it needs a fresh review before deploying. If it says the wallet needs more MON, top it up and rerun.

## 5. Deploy (one real transaction)

Use the code from step 4:

```
npm.cmd run deploy:mainnet -- --broadcast --confirm CHOG-XXXXXXXX
```

If anything changed since preflight (for example the wallet sent another transaction), it refuses and
asks you to rerun step 4. On success it prints the adapter address and a record file in
`deployments/`, and confirms the deployed code matches exactly.

**If it fails after printing a transaction hash, do not run it again.** Paste the output to Claude
so the transaction can be checked on chain first.

## 6. Publish the source

Use the record file path printed in step 5:

```
npm.cmd run verify:mainnet -- --record deployments/<file>-monad-mainnet.json
```

This publishes to Sourcify, and to MonadScan if `MONADSCAN_API_KEY` is set.

## 7. Hand back

Paste the outputs of steps 4–6 to Claude to check on chain. Then share the adapter address with the
Chog City teammate. City should compute each Chog's wallet with the Tokenbound SDK defaults
(registry `0x000000006551c19487814612e58FE06813775758`, implementation
`0x55266d75D1a14E4572138116aF39863Ed6596E7F`, salt 0).

Any time later, this re-checks the deployed adapter read-only:

```
npm.cmd run deploy:mainnet -- --check <adapter address>
```
