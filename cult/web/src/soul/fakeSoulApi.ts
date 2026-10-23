// Test helper: answers Chog Soul's endpoints for component tests that stub fetch.
export const SOUL_CONFIG = {
  ai: true, model: "fake/model", payment: { mode: "fixture", chainId: 31337, token: null, treasury: null },
  prices: { chat: "1", debate: "0.25", vote: "0.25" }, defaultDailyCap: "20", maxDailyCap: "1000",
};

export function soulResponse(url: string, method: string, state: { balance: string; messages: { role: "holder" | "chog"; text: string; createdAt: string }[] }): unknown | undefined {
  if (url === "/api/soul/config") return SOUL_CONFIG;
  if (url === "/api/soul/me") return { address: "0xabc0000000000000000000000000000000000def", balance: state.balance, held: "0", usage: [], deposits: [] };
  if (/^\/api\/soul\/chogs\/[^/]+$/.test(url)) return { persona: { name: "Chog", temperament: ["regal"], talents: ["ruling"], voice: "grand, formal speech", catchphrase: "By decree of the crown!", summary: "A regal Chog." } };
  if (/^\/api\/soul\/chogs\/[^/]+\/private$/.test(url)) return { epoch: "2", messages: state.messages, settings: { aiEnabled: false, dailyCap: "20", spentToday: "0" } };
  if (/\/settings$/.test(url) && method === "PUT") return { settings: { aiEnabled: true, dailyCap: "20" } };
  if (/\/chat$/.test(url) && method === "POST") {
    state.messages.push({ role: "holder", text: "(sent)", createdAt: "" }, { role: "chog", text: "By decree, hello!", createdAt: "" });
    state.balance = String(Number(state.balance) - 1);
    return { reply: "By decree, hello!", price: "1", balance: state.balance };
  }
  return undefined;
}
