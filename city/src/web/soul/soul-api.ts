// Chog Soul's API on the Chog server (cult/src/api/soulRoutes.ts): persona, $CHOG credits, AI consent, chat.
import { call, guardHeaders } from '../api/http-client';

export interface SoulConfig {
  ai: boolean;
  model: string;
  payment: { mode: 'chog' | 'fixture'; chainId: number; token: string | null; treasury: string | null };
  prices: { chat: string; debate: string; vote: string };
  defaultDailyCap: string;
  maxDailyCap: string;
}

export interface Persona {
  name: string;
  temperament: string[];
  talents: string[];
  voice: string;
  catchphrase: string;
  summary: string;
}

export interface SoulAccount {
  address: string;
  balance: string;
  held: string;
  usage: { id: string; action: string; price: string; status: string; createdAt: string; failure: string | null }[];
  deposits: { txHash: string; amount: string; creditedAt: string }[];
}

export interface SoulPrivate {
  epoch: string;
  messages: { role: 'holder' | 'chog'; text: string; createdAt: string }[];
  settings: { aiEnabled: boolean; dailyCap: string; spentToday: string };
}

const chogPath = (agentKey: string) => `/api/soul/chogs/${encodeURIComponent(agentKey)}`;

export const soulApi = {
  config: () => call<SoulConfig>('/api/soul/config'),
  persona: (agentKey: string) => call<{ persona: Persona }>(chogPath(agentKey)),
  me: () => call<SoulAccount>('/api/soul/me'),
  private: (agentKey: string) => call<SoulPrivate>(`${chogPath(agentKey)}/private`),
  settings: (agentKey: string, body: { aiEnabled: boolean; dailyCap: string; expectedEpoch: string }) =>
    call<{ settings: { aiEnabled: boolean; dailyCap: string } }>(`${chogPath(agentKey)}/settings`, { method: 'PUT', body, headers: guardHeaders() }),
  /** One key per message: the server answers a repeated key with the stored reply instead of charging again. */
  chat: (agentKey: string, message: string, idempotencyKey: string) =>
    call<{ reply: string; price: string; balance: string }>(`${chogPath(agentKey)}/chat`, {
      method: 'POST',
      body: { message },
      headers: { ...guardHeaders(), 'idempotency-key': idempotencyKey },
    }),
};
