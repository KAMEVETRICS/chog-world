// Strict validation for IDs, policies, requests and world state.
import { z } from 'zod';
import { RESOURCE_CAP, VILLAGER_OPTIONS } from './rules';

const UINT256_MAX = 2n ** 256n - 1n;

/** Canonical decimal uint256: no sign, no leading zeros (except "0"), <= 2^256-1. */
export const uint256StringSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, 'must be a canonical non-negative decimal string')
  .refine((value) => value.length <= 78 && BigInt(value) <= UINT256_MAX, 'exceeds uint256 maximum');

export const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address');

const placeIdSchema = z.enum(['plaza', 'tavern', 'workshop', 'forest', 'quarry', 'farm']);
export const focusSchema = z.enum(['builder', 'gatherer', 'social']);
export const homeStyleSchema = z.enum(['cottage', 'workshop', 'treehouse']);

const quantitySchema = z.number().int().min(0).max(RESOURCE_CAP);
const inventoryLineSchema = z
  .object({ total: quantitySchema, reserved: quantitySchema })
  .strict()
  .refine((line) => line.reserved <= line.total, 'reserved exceeds total');
const resourceAmountsSchema = z.object({ wood: quantitySchema, stone: quantitySchema, food: quantitySchema }).strict();

export const policySchema = z
  .object({ version: uint256StringSchema, active: z.boolean(), focus: focusSchema, homeStyle: homeStyleSchema })
  .strict();

export const policyUpdateRequestSchema = z
  .object({
    expectedVersion: uint256StringSchema,
    expectedEpoch: uint256StringSchema,
    active: z.boolean(),
    focus: focusSchema,
    homeStyle: homeStyleSchema,
  })
  .strict();

export const decorateRequestSchema = z
  .object({ expectedEpoch: uint256StringSchema, item: z.enum(['lantern', 'flowerbed', 'bench', 'well']) })
  .strict();

/** A villager's name: 2-20 characters, starting with a letter; letters, digits, spaces, ' and -. */
export const villagerNameSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9 '-]{1,19}$/, 'use 2-20 letters, digits, spaces, apostrophes or hyphens, starting with a letter');

const oneOf = (values: readonly string[]) => z.string().refine((v) => values.includes(v), 'not an allowed villager look');
export const villagerLookSchema = z
  .object({ Skin: oneOf(VILLAGER_OPTIONS.Skin), Head: oneOf(VILLAGER_OPTIONS.Head), Body: oneOf(VILLAGER_OPTIONS.Body), Eyes: oneOf(VILLAGER_OPTIONS.Eyes) })
  .strict();

export const joinRequestSchema = z.object({ name: villagerNameSchema, look: villagerLookSchema }).strict();
export const jobRequestSchema = z
  .object({ expectedVersion: uint256StringSchema, job: z.enum(['farmhand', 'woodcutter', 'quarrier', 'off']) })
  .strict();

const resourceSchema = z.enum(['wood', 'stone', 'food']);
const assetSchema = z.enum(['coins', 'wood', 'stone', 'food']);
const partySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('citizen') }).strict(),
  z.object({ kind: z.literal('chog'), key: z.string().min(1).max(400), expectedEpoch: uint256StringSchema }).strict(),
]);
const amountSchema = z.number().int().min(1).max(500);
const offerSchema = z.object({ job: z.enum(['farmhand', 'woodcutter', 'quarrier']), wage: z.number().int().min(1).max(10) }).strict();

const paramIdSchema = z.enum(['farmYield', 'forestYield', 'quarryYield', 'wage', 'incomeTaxPct', 'marketFeePct']);
export const proposalTitleSchema = z.string().trim().min(3, 'give the proposal a title of at least 3 characters').max(80);
const proposalChangeSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('params'), values: z.partialRecord(paramIdSchema, z.number().int().min(0).max(100)).refine((v) => Object.keys(v).length > 0, 'change at least one rule') })
    .strict(),
  z.object({ kind: z.literal('fund'), projectId: z.enum(['fountain', 'market_hall']), asset: assetSchema, amount: amountSchema }).strict(),
]);

/** One player action (gift, trade, job offer, taking an offer, project contribution, proposal, vote). */
export const cityActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('gift'), from: partySchema, to: z.string().min(1).max(400), asset: assetSchema, amount: amountSchema }).strict(),
  z
    .object({ type: z.literal('trade'), chog: z.string().min(1).max(400), expectedEpoch: uint256StringSchema, side: z.enum(['sell', 'buy']), resource: resourceSchema, amount: amountSchema })
    .strict(),
  z.object({ type: z.literal('offer'), chog: z.string().min(1).max(400), expectedEpoch: uint256StringSchema, offer: offerSchema.nullable() }).strict(),
  z.object({ type: z.literal('take_offer'), employer: z.string().min(1).max(400) }).strict(),
  z.object({ type: z.literal('contribute'), projectId: z.enum(['fountain', 'market_hall']), from: partySchema, asset: assetSchema, amount: amountSchema }).strict(),
  z
    .object({ type: z.literal('propose'), chog: z.string().min(1).max(400), expectedEpoch: uint256StringSchema, title: proposalTitleSchema, change: proposalChangeSchema })
    .strict(),
  z.object({ type: z.literal('vote'), proposalId: z.string().regex(/^p[1-9][0-9]{0,8}$/), ballot: z.enum(['yes', 'no']) }).strict(),
  z
    .object({
      type: z.literal('speak'),
      chog: z.string().min(1).max(400),
      expectedEpoch: uint256StringSchema,
      proposalId: z.string().regex(/^p[1-9][0-9]{0,8}$/),
      stance: z.enum(['for', 'against']),
      text: z.string().trim().min(1).max(280),
    })
    .strict(),
]);

/** What a Chog's AI must reply in a council session (see council.ts). Anything else is ignored. */
export const councilReplySchema = z
  .object({
    speeches: z
      .array(z.object({ proposalId: z.string().regex(/^p[1-9][0-9]{0,8}$/), stance: z.enum(['for', 'against']), text: z.string().min(1).max(600) }))
      .max(5),
    proposal: z.object({ title: z.string().min(3).max(120), change: proposalChangeSchema }).nullable(),
  })
  .strip();

export const instructionsRequestSchema = z.object({ expectedEpoch: uint256StringSchema, text: z.string().max(600) }).strict();

const identitySchema = z
  .object({
    chainId: uint256StringSchema,
    registry: addressSchema,
    adapter: addressSchema,
    collection: addressSchema,
    tokenId: uint256StringSchema,
    agentId: uint256StringSchema,
  })
  .strict();

const controlSchema = z
  .object({
    kind: z.enum(['controlled', 'burned', 'unbound']),
    controller: addressSchema.nullable(),
    epoch: uint256StringSchema,
    projectionGeneration: uint256StringSchema,
    blockNumber: uint256StringSchema,
    blockHash: z.string(),
    observedAtMs: z.number().int().nonnegative(),
  })
  .strict()
  .refine((c) => (c.kind === 'controlled') === (c.controller !== null), 'controller must be set iff controlled');

const locationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('place'), placeId: placeIdSchema }).strict(),
  z.object({ kind: z.literal('plot'), plotId: z.string() }).strict(),
]);

const constructionSchema = z
  .object({
    actionId: z.string(),
    targetLevel: z.number().int().min(1),
    costs: resourceAmountsSchema,
    remainingTicks: z.number().int().min(0),
    policyVersion: uint256StringSchema,
    ownershipEpoch: uint256StringSchema,
    startedTick: uint256StringSchema,
  })
  .strict();

const needSchema = z.number().int().min(0).max(100);

const agentSchema = z
  .object({
    key: z.string(),
    identity: identitySchema,
    name: z.string(),
    control: controlSchema,
    controlAvailability: z.enum(['verified', 'unavailable']),
    plotId: z.string(),
    location: locationSchema,
    policy: policySchema,
    inventory: z.object({ wood: inventoryLineSchema, stone: inventoryLineSchema, food: inventoryLineSchema }).strict(),
    homeLevel: z.number().int().min(0),
    homeStyle: homeStyleSchema,
    construction: constructionSchema.nullable(),
    lastGreetingTick: uint256StringSchema.nullable(),
    needs: z.object({ energy: needSchema, hunger: needSchema, fun: needSchema, social: needSchema }).strict(),
    decor: z.array(z.enum(['lantern', 'flowerbed', 'bench', 'well'])).max(4),
    coins: z.number().int().min(0),
    offer: offerSchema.nullable(),
  })
  .strict();

const coinsSchema = z.number().int().min(0);
const paramValuesSchema = z
  .object({ farmYield: coinsSchema, forestYield: coinsSchema, quarryYield: coinsSchema, wage: coinsSchema, incomeTaxPct: coinsSchema, marketFeePct: coinsSchema })
  .strict();
const projectSchema = z
  .object({
    given: z.object({ wood: coinsSchema, stone: coinsSchema, food: coinsSchema, coins: coinsSchema }).strict(),
    completedTick: uint256StringSchema.nullable(),
  })
  .strict();
const citizenSchema = z
  .object({
    key: z.string().regex(/^citizen:0x[0-9a-f]{40}$/),
    address: addressSchema,
    name: villagerNameSchema,
    look: villagerLookSchema,
    lotId: z.string(),
    location: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('place'), placeId: placeIdSchema }).strict(),
      z.object({ kind: z.literal('lot'), lotId: z.string() }).strict(),
    ]),
    job: z.enum(['farmhand', 'woodcutter', 'quarrier', 'off']),
    jobVersion: uint256StringSchema,
    coins: coinsSchema,
    joinedTick: uint256StringSchema,
    activeDays: z.number().int().min(0),
    lastWorkedDay: z.number().int().min(0).nullable(),
    employer: z.string().nullable(),
  })
  .strict();

export const worldStateSchema = z
  .object({
    cityId: z.string(),
    tick: uint256StringSchema,
    seed: z.string(),
    rulesetVersion: z.string(),
    places: z.array(z.object({ id: placeIdSchema, name: z.string(), x: z.number().int(), y: z.number().int() }).strict()),
    plots: z.array(z.object({ id: z.string(), x: z.number().int(), y: z.number().int() }).strict()),
    agents: z.array(agentSchema),
    lots: z.array(z.object({ id: z.string(), x: z.number().int(), y: z.number().int() }).strict()),
    citizens: z.array(citizenSchema),
    params: z.object({ version: uint256StringSchema, values: paramValuesSchema }).strict(),
    treasury: z.object({ coins: coinsSchema, stores: z.object({ wood: coinsSchema, stone: coinsSchema, food: coinsSchema }).strict() }).strict(),
    projects: z.object({ fountain: projectSchema, market_hall: projectSchema }).strict(),
    proposals: z.array(
      z
        .object({
          id: z.string(),
          proposer: z.string(),
          title: z.string(),
          change: proposalChangeSchema,
          openedTick: uint256StringSchema,
          closesTick: uint256StringSchema,
          votes: z.record(z.string(), z.enum(['yes', 'no'])),
          speeches: z.array(
            z
              .object({ agentKey: z.string(), stance: z.enum(['for', 'against']), text: z.string().max(280), tick: uint256StringSchema, by: z.enum(['ai', 'rules', 'holder']) })
              .strict(),
          ),
          status: z.enum(['open', 'passed', 'rejected', 'failed']),
          resolvedTick: uint256StringSchema.nullable(),
          outcome: z.string().nullable(),
        })
        .strict(),
    ),
    proposalSeq: z.number().int().min(0),
  })
  .strict();
