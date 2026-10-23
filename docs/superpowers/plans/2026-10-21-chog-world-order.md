# Chog World Order build plan (open City, agent government, Chog Bots, skills)

Agreed with the user on 2026-10-21; the teammate agrees. This plan extends the shipped work: ChogAdapter on
Monad mainnet, Chog Soul (persona, holder chat, $CHOG credits), Chog Cult (factions, cycles, decrees) and
Chog City (simulation, needs, mood and decorating, ruleset `city-m1-needs`). Research behind the borrowed
ideas: `docs/research/normies/NORMIES_RESEARCH_2026-10-21.md`.

## Decisions

| Topic | Decision |
|---|---|
| Who plays City | Everyone. Non-holders are **citizens** with a visible, Chog-like villager. NFT Chogs are autonomous agents. |
| Citizens' villagers | Played by their human (they choose job and place each day); not AI. |
| Lawmaking | Chog agents debate and propose; **everyone** votes to pass (one vote per eligible account). |
| Offices | Only Chogs can hold office (Mayor, Reserve Governor). Everyone votes; humans rally behind candidates. |
| City money | In-game only, kept in the ledger. Name to be chosen. |
| $CHOG link | **Before launch**, one way only: $CHOG buys city money or rare items. City money can never be cashed out. |
| Owner instructions | Given only in private: the Soul page, a DM to the bot, or an ephemeral `/chog instruct`. Public messages are chat, never orders. |
| Bots at launch | Open: skills/profiles, Discord and the agent card are the recommendation; x402 and X after. |

## Ground rules

- **The simulation stays deterministic.** AI output, votes and purchases enter only as recorded events;
  passed rules apply at a tick boundary. Every world can be replayed and checked.
- **One ledger** for materials, city money, treasury, gifts, wages, purchases and $CHOG deposits;
  `reconcile` must stay empty.
- **The constitution is code.** Votes and offices can only move listed parameters within their ranges.
- **AI never decides outcomes directly.** It chooses among valid actions in a checked format; a failure
  abstains or falls back to the deterministic choice. Text from other agents and public channels is data.
- **Honest capability flags.** Agent cards and manifests advertise only endpoints that work (Normies'
  biggest gap is advertising routes that don't exist).
- **Ownership fences everything.** On sale, instructions, Discord control, sessions and private memory end
  for the seller; credentials and public history stay with the Chog.
- **Who builds what:** `city/` (simulation, rules, villagers, UI) is the teammate's area; changes there
  follow its style and are reviewed with them. Server, database, agents, bots and chain are in `cult/`.

## Track A: the game

### A0 Foundations
- `city/src/shared/constitution.ts`: every changeable number with default, min, max and max step per vote
  (tax, market fee, yields, wages, billboard price, $CHOG rate).
- Parameters live in `WorldState`, versioned; the simulation reads them instead of constants.
- City money: balances for every account, a treasury account, ledger reasons for each flow.

### A1 Open City
- Citizen sign-in (wallet, no NFT). Generated Chog-like villager, customizable; a new district for
  citizen homes.
- Citizens choose a job and place each day; their villager carries it out.
- Gifts between residents; a market at the Plaza; jobs and wages (Chogs hire citizens); shared projects.
- Voting eligibility after a few active days (anti-sybil).

### A2 Rules people vote on
- Proposals: change a parameter within the constitution, spend from the treasury, start a project.
- Cycle: Chogs debate and propose, everyone votes, results apply at the cycle's end. Builds on Cult's
  existing cycles and decrees.

### A3 The agent council
- Owners' standing instructions (private; see Decisions) feed each Chog's turn.
- Each cycle a Chog's AI reads the agenda, a city summary and its instructions, gives a short speech in
  character and proposes or backs proposals in a strict schema. Failure means abstain.
- Costs come from Soul credits with a cap; speeches are public and moderated; owners see the reasons.

### A4 Offices and civic life
- Elections every few village days for Mayor (projects, treasury budget) and Reserve Governor (tax, money
  supply, $CHOG rate). Office holders set their numbers within narrower ranges than a full vote. Recall
  votes are always possible.
- Billboards: ad spots on the map bought with city money; moderated content.

### A5 $CHOG one-way (before launch)
- Deposits through Soul's existing deposit indexer become city money or rare cosmetic items at a
  constitution-bounded, Governor-set rate. No withdrawals; purchases are final and say so.

## Track B: Chog Bots

One brain per Chog (Soul: persona, memory, skills, permissions, budget). Every surface is a channel into it:
web chat (built), City, the Cult council, Discord, X and other agents (A2A). What a Chog does on Discord shows
in City's activity and shapes how it argues in Cult.

- **B1 Profiles and tool skills.** Social, Research, Community Moderator, Onchain Analyst: each a fixed set
  of tools and permissions (see Track D).
- **B2 Discord.** One shared "Chog World" app that speaks as each Chog (its name and picture via webhooks).
  Owners link Discord with OAuth; server admins add the app once. Chogs answer only when invoked
  (`/chog ask`, `/chog summon`, mention). Tasks: questions, City and Cult news, on-chain lookups, channel
  summaries where allowed. Owners instruct via DM or ephemeral `/chog instruct`. The user creates the
  Discord application; its token never passes through chat.
- **B3 Agent card, A2A and MCP.** A public agent card per Chog, listed in its ERC-8004 registration, an A2A
  endpoint for other agents, and approved tools over MCP.
- **B4 x402 earnings.** Others pay a Chog per task; earnings go to its ERC-6551 wallet. Good work becomes
  ERC-8004 reputation feedback.
- **B5 X.** The owner connects an X account for the Chog; drafts need approval, or it auto-posts only its own
  updates. No unsolicited replies. Grok is available as a model through OpenRouter.
- **Controls and safety from day one:** per-channel on/off, daily credit caps, approved servers and
  channels, a kill switch, a full activity log, revocation on sale. At launch the bot can receive funds
  but never signs transactions. Replies are moderated and rate-limited.

## Track C: ideas borrowed from Normies

1. **Layered persona engine.** Replace the keyword matcher in `cult/src/soul/persona.ts` with Normies'
   structure: each Chog Genesis trait category shapes one part of the character (voice, pace, focus,
   quirks, greeting), plus written origin stories chosen by a token-seeded selector. Deterministic, no AI.
   The generator is versioned (`personaVersion`) so a persona never changes silently.
2. **Biography from game life** (the Chog version of Normies' Canvas bands). The persona grows from
   recorded City and Cult history: bands such as newcomer, settler, elder and councillor, plus facts like
   home level, decorations, faction and offices held. Facts come from the ledger and events; their
   telling is characterization.
3. **A Chog constitution.** A value block in every agent prompt (council and bots): disagreement is healthy,
   equal worth regardless of rarity, honesty about uncertainty, never ask for keys or push transactions,
   no manipulative urgency. Adds a Cult role modelled on Normies' governance "Whisperer" that watches for
   groupthink.
4. **Arena-style life in City:**
   - nightly reflection: one short diary entry per village day, saved to the Chog's memory (cheap,
     capped);
   - ambitions that steer behaviour within the valid actions;
   - a game master that drops in events (festivals, storms, shortages) from a fixed, seeded table;
   - a city chronicle, with statues for past Mayors and Governors.
5. **Persona preview before awakening.** Anyone, holder or not, can meet any Chog's character
   (`/soul/` preview by token ID). Fits "City for everyone" and gives holders a reason to awaken.
6. **Agent card and a public gallery of awakened Chogs,** advertising only what works. The on-chain
   registration links to the agent card and A2A endpoint, so **a permanent domain must exist before the
   first real awakening** (the owner can update the link later, but should not have to).

## Track D: skills (our design)

Normie University sells JSON skill modules for USDC, checks the on-chain action, and mints a soulbound
certificate to the *wallet*, so skills don't follow the NFT. Ours fixes that and ties skills to the game.

- **Tool skills** are what a Chog can do as a bot: summarize, on-chain lookup, moderate, research. Each is
  a module: `{id, name, profiles, tools, permissions, promptFragment, creditCost, unlock}`. Profiles bundle
  them; each use costs credits.
- **Earned credentials** are proofs of real activity, checked from our own ledger and events (no outside
  oracle): Master Builder (level-2 home), Councillor (passed a proposal), Governor (served a term), Helper
  (50 well-rated Discord answers), and more.
- **Bound to the agent ID, not a wallet,** so credentials follow the Chog on sale. Recorded as ERC-8004
  reputation feedback and listed on the agent card.
- **Learning in City:** a Chog can study at the Workshop for a few village days, paying city money, to
  unlock a tool skill. Skills become part of the economy.

## Order

1. A0 and A1, tested on the fixture village first.
2. C1 (persona engine) and C3 (constitution), since every later AI feature uses them.
3. A2, then A3 with B1, then B2 (Discord).
4. A4, C2, C4, C5, D (skills), B3 (agent card), with C6 once the domain exists.
5. A5 ($CHOG one-way) before launch; B4 and B5 as launch scope allows.

## Launch checklist

- A permanent domain (also fixes the OKX phishing warning on the sslip.io address).
- The OpenRouter key with a spending limit, supplied by the user.
- Moderation on for speeches, bot replies and billboards.
- A load test with many citizens.
- A backup and restore drill (daily backups already run).
- Legal and fairness review of the one-way $CHOG purchase.
