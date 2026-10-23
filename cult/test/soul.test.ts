import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { formatChog, parseChog } from "../src/soul/config.js";
import { personaFor } from "../src/soul/persona.js";
import { OpenRouterProvider, ProviderError, cleanOutput } from "../src/soul/provider.js";
import { parseVoteChoices } from "../src/soul/service.js";

const servers: http.Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve)))); });

async function fakeOpenRouter(handler: (body: Record<string, unknown>, headers: http.IncomingHttpHeaders, response: http.ServerResponse) => void): Promise<string> {
  const server = http.createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    handler(JSON.parse(text), request.headers, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("persona", () => {
  it("comes from traits, deterministically, with a fallback for unknown traits", () => {
    const regent = personaFor("Regent", { Aura: "Royal Aura", Body: "Kings Robe", Head: "Crown", Mouth: "Smile" }, "k1");
    expect(regent.temperament).toEqual(["regal", "friendly"]);
    expect(regent.talents).toEqual(["ruling", "giving orders"]);
    expect(regent.voice).toBe("grand, formal speech");
    expect(personaFor("Regent", { Aura: "Royal Aura", Body: "Kings Robe", Head: "Crown", Mouth: "Smile" }, "k1")).toEqual(regent);
    const plain = personaFor("Blank", {}, "k2");
    expect(plain).toMatchObject({ temperament: ["curious"], talents: ["making friends"] });
    expect(plain.summary).toContain("Blank is curious");
  });
});

describe("CHOG amounts", () => {
  it("parse and format with 18 decimals, rejecting anything else", () => {
    expect(parseChog("1")).toBe(10n ** 18n);
    expect(parseChog("0.25")).toBe(25n * 10n ** 16n);
    expect(formatChog(parseChog("20.5"))).toBe("20.5");
    expect(formatChog(0n)).toBe("0");
    for (const bad of ["", "-1", "1.", "abc", "0.0000000000000000001", "01"]) expect(() => parseChog(bad)).toThrow();
  });
});

describe("model output", () => {
  it("is stripped of markup and control characters and capped in length", () => {
    expect(cleanOutput("  <b>Hello</b> **there**\n\n#friend\u0007  ", 100)).toBe("Hello there friend");
    expect(cleanOutput("x".repeat(50), 10)).toBe("xxxxxxxxx…");
  });

  it("only yields allowed decree IDs for the voter's faction", () => {
    expect(parseVoteChoices('Sure! {"plaza":"golden-lanterns","tavern":"bell-riot","workshop":"nope"}', "crown")).toEqual({ plaza: "golden-lanterns" });
    expect(parseVoteChoices("no json here", "chaos")).toEqual({});
    expect(parseVoteChoices('{"plaza": 7}', "chaos")).toEqual({});
  });
});

describe("OpenRouter provider", () => {
  it("sends the model, system prompt, token cap and usage request, and reads text, tokens and cost", async () => {
    let seen: { body: Record<string, unknown>; headers: http.IncomingHttpHeaders } | undefined;
    const url = await fakeOpenRouter((body, headers, response) => {
      seen = { body, headers };
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ model: "anthropic/claude-haiku-5.5", choices: [{ message: { content: "Hello, neighbour!" } }], usage: { prompt_tokens: 120, completion_tokens: 8, cost: 0.000016 } }));
    });
    const provider = new OpenRouterProvider({ apiKey: "test-key", model: "anthropic/claude-haiku-5.5", baseUrl: url, appUrl: "https://chog.example" });
    const result = await provider.complete({ system: "You are Regent.", messages: [{ role: "user", content: "Hi" }], maxTokens: 50 });
    expect(result).toEqual({ text: "Hello, neighbour!", model: "anthropic/claude-haiku-5.5", promptTokens: 120, completionTokens: 8, costUsd: 0.000016 });
    expect(seen!.headers.authorization).toBe("Bearer test-key");
    expect(seen!.headers["http-referer"]).toBe("https://chog.example");
    expect(seen!.body).toMatchObject({ model: "anthropic/claude-haiku-5.5", max_tokens: 50, usage: { include: true }, messages: [{ role: "system", content: "You are Regent." }, { role: "user", content: "Hi" }] });
  });

  it("reports provider errors and timeouts without echoing the key", async () => {
    const failing = await fakeOpenRouter((_body, _headers, response) => { response.statusCode = 429; response.end(JSON.stringify({ error: { message: "Rate limited" } })); });
    const provider = new OpenRouterProvider({ apiKey: "secret-key", model: "m", baseUrl: failing });
    await expect(provider.complete({ system: "s", messages: [], maxTokens: 5 })).rejects.toThrow(/HTTP 429: Rate limited/);
    const silent = await fakeOpenRouter(() => { /* never answers */ });
    const slow = new OpenRouterProvider({ apiKey: "secret-key", model: "m", baseUrl: silent, timeoutMs: 100 });
    const error = await slow.complete({ system: "s", messages: [], maxTokens: 5 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(String(error)).toMatch(/no answer within 100 ms/);
    expect(String(error)).not.toContain("secret-key");
  });
});
