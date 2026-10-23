import { call, guarded } from "../api";

export interface SoulConfig {
  readonly ai: boolean;
  readonly model: string;
  readonly payment: { readonly mode: "chog" | "fixture"; readonly chainId: number; readonly token: string | null; readonly treasury: string | null };
  readonly prices: { readonly chat: string; readonly debate: string; readonly vote: string };
  readonly defaultDailyCap: string;
  readonly maxDailyCap: string;
}

export interface Persona {
  readonly name: string;
  readonly temperament: readonly string[];
  readonly talents: readonly string[];
  readonly voice: string;
  readonly catchphrase: string;
  readonly summary: string;
}

export interface SoulAccount {
  readonly address: string;
  readonly balance: string;
  readonly held: string;
  readonly usage: readonly { readonly id: string; readonly action: string; readonly price: string; readonly status: string; readonly createdAt: string; readonly failure: string | null }[];
  readonly deposits: readonly { readonly txHash: string; readonly amount: string; readonly creditedAt: string }[];
}

export interface SoulPrivate {
  readonly epoch: string;
  readonly messages: readonly { readonly role: "holder" | "chog"; readonly text: string; readonly createdAt: string }[];
  readonly settings: { readonly aiEnabled: boolean; readonly dailyCap: string; readonly spentToday: string };
}

export const soulApi = {
  config: () => call<SoulConfig>("/api/soul/config"),
  persona: (agentKey: string) => call<{ persona: Persona }>(`/api/soul/chogs/${agentKey}`),
  me: () => call<SoulAccount>("/api/soul/me"),
  private: (agentKey: string) => call<SoulPrivate>(`/api/soul/chogs/${agentKey}/private`),
  settings: (csrf: string, agentKey: string, body: { aiEnabled: boolean; dailyCap: string; expectedEpoch: string }) =>
    call<{ settings: { aiEnabled: boolean; dailyCap: string } }>(`/api/soul/chogs/${agentKey}/settings`, { method: "PUT", body: JSON.stringify(body), headers: guarded(csrf) }),
  chat: (csrf: string, agentKey: string, message: string) =>
    call<{ reply: string; price: string; balance: string }>(`/api/soul/chogs/${agentKey}/chat`, { method: "POST", body: JSON.stringify({ message }), headers: guarded(csrf) }),
};

export interface BotSettings {
  readonly enabled: boolean;
  readonly profile: string;
  readonly channels: { readonly web: boolean; readonly discord: boolean };
  readonly servers: readonly string[];
  readonly dailyReplies: number;
}

export interface BotConfig {
  readonly profiles: readonly { readonly id: string; readonly name: string; readonly description: string; readonly skills: readonly string[] }[];
  readonly skills: readonly { readonly id: string; readonly name: string; readonly description: string; readonly input: string; readonly maxInput: number }[];
  readonly maxServers: number;
}

export interface BotActivity {
  readonly channel: string;
  readonly skill: string;
  readonly input: string;
  readonly reply: string | null;
  readonly outcome: "answered" | "declined";
  readonly reason: string | null;
  readonly createdAt: string;
}

export const botApi = {
  config: () => call<BotConfig>("/api/soul/bots/config"),
  settings: (agentKey: string) => call<{ settings: BotSettings & { epoch: string } }>(`/api/soul/chogs/${agentKey}/bot`),
  save: (csrf: string, agentKey: string, body: BotSettings & { expectedEpoch: string }) =>
    call<{ settings: BotSettings }>(`/api/soul/chogs/${agentKey}/bot`, { method: "PUT", body: JSON.stringify(body), headers: guarded(csrf) }),
  activity: (agentKey: string) => call<{ activity: readonly BotActivity[] }>(`/api/soul/chogs/${agentKey}/bot/activity`),
  tryIt: (csrf: string, agentKey: string, body: { skill: string; input: string }) =>
    call<{ reply: string } | { declined: string; message: string }>(`/api/soul/chogs/${agentKey}/bot/try`, { method: "POST", body: JSON.stringify(body), headers: guarded(csrf) }),
};
