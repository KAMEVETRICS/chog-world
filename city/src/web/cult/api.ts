import type { FactionId, Phase, Place, Stance } from '../../../../cult/src/rules';
import { call, CityApiError, guardHeaders } from '../api/http-client';
import type { PlaceRule } from './rulers';

export interface CultVote { place: Place; decreeId: string | null; source: 'agent' | 'holder' }
export interface CultMember {
  agentKey: string; name: string; faction: FactionId | null; stance: Stance; joinedCycle: number | null;
  control: string; currentVotes: CultVote[]; reputation: { loyalty: number; glory: number };
}
export interface CultEvent { revision: string; cycle: number; type: string; payload: unknown; createdAt: string }
export interface CultSnapshot {
  revision: string; cycle: number; phase: Phase; nextBoundaryAt: string; places: PlaceRule[];
  factions: { id: FactionId; name: string; creed: string; members: number; placesRuled: Place[]; glory: number }[];
  members: CultMember[]; recentEvents: CultEvent[];
}
export interface MyCultChog {
  agentKey: string; name: string; faction: FactionId | null; stance: Stance; joinedCycle: number | null;
  ownershipEpoch: string; control: string;
}

const headers = () => ({ ...guardHeaders(), 'idempotency-key': crypto.randomUUID() });
export const cultApi = {
  snapshot: () => call<CultSnapshot>('/api/cult/snapshot'),
  async mine(): Promise<MyCultChog[] | null> {
    try { return (await call<{ chogs: MyCultChog[] }>('/api/me')).chogs ?? []; }
    catch (error) { if (error instanceof CityApiError && error.status === 401) return null; throw error; }
  },
  membership: (chog: MyCultChog, change: { faction?: FactionId | null; stance?: Stance }) =>
    call(`/api/cult/members/${encodeURIComponent(chog.agentKey)}`, { method: 'PUT', headers: headers(), body: { ...change, expectedEpoch: chog.ownershipEpoch } }),
  vote: (chog: MyCultChog, cycle: number, place: Place, decreeId: string | null) =>
    call(`/api/cult/votes/${cycle}/${encodeURIComponent(chog.agentKey)}/${place}`, { method: 'PUT', headers: headers(), body: { decreeId, expectedEpoch: chog.ownershipEpoch } }),
};
