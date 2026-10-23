// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { soulResponse } from "./soul/fakeSoulApi";
import { App } from "./App";
import type { EventDto, SnapshotDto } from "./api";

const REGENT = "31337:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:0x00000000000000000000000000000000000c4a77:0x00000000000000000000000000000000000c6091:1:101";
const EMBER = REGENT.replace(":1:101", ":4:104");

function snapshot(overrides: Partial<SnapshotDto> = {}): SnapshotDto {
  const member = (agentKey: string, name: string, faction: "crown" | "chaos" | null) => ({
    agentKey, name, identity: {} as never, traits: {}, faction, stance: faction ? "persona" as const : "abstain" as const, joinedCycle: faction ? 0 : null,
    control: "verified" as const, history: [], reputation: { loyalty: 2, glory: 3 }, currentVotes: [],
  });
  return {
    revision: "10", cycle: 2, phase: "debate", phaseStartedAt: "2026-10-20T00:00:00.000Z", nextBoundaryAt: new Date(Date.now() + 75_000).toISOString(),
    places: [
      { place: "plaza", ruler: "crown", sinceCycle: 1, decree: { id: "golden-lanterns", title: "Golden Lanterns", banner: "lantern-gold", feedLine: "Golden lanterns light the Plaza." } },
      { place: "tavern", ruler: null, sinceCycle: null, decree: null },
      { place: "workshop", ruler: "chaos", sinceCycle: 2, decree: { id: "laser-tinkering", title: "Laser Tinkering", banner: "laser-green", feedLine: "Lasers cut through the Workshop." } },
    ],
    factions: [
      { id: "crown", name: "The Crown", creed: "Order, wealth and influence.", members: 1, placesRuled: ["plaza"], glory: 3 },
      { id: "chaos", name: "The Chaos", creed: "Freedom, noise and disruption.", members: 1, placesRuled: ["workshop"], glory: 3 },
    ],
    members: [member(REGENT, "Regent", "crown"), member(EMBER, "Ember", "chaos")],
    recentEvents: [event(9, "debate", { agentKey: EMBER, text: "Ember wants the <b>Tavern</b> loud!", scripted: true })],
    ...overrides,
  };
}

function event(revision: number, type: string, payload: unknown): EventDto {
  return { revision: String(revision), cycle: 2, type, payload, createdAt: "2026-10-20T00:00:00.000Z" };
}

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { FakeEventSource.instances.push(this); queueMicrotask(() => this.onopen?.()); }
  addEventListener(type: string, listener: (message: MessageEvent<string>) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  close() { this.closed = true; }
  emit(type: string, data: unknown) { for (const listener of this.listeners.get(type) ?? []) listener({ data: JSON.stringify(data) } as MessageEvent<string>); }
}

let soulState: { balance: string; messages: { role: "holder" | "chog"; text: string; createdAt: string }[] };
interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }
let calls: Call[];
let current: SnapshotDto;
let meResponse: unknown;
let putResponse: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  current = snapshot();
  meResponse = null;
  putResponse = { status: 200, body: { member: {} } };
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/cult/config") return json(200, { mode: "fixture", label: "Fixture Village", chainIds: [31337], login: true });
    if (url === "/api/cult/snapshot") return json(200, current);
    const soul = soulResponse(url, method, soulState);
    if (soul !== undefined) return json(200, soul);
    if (url === "/api/me") return meResponse ? json(200, meResponse) : json(401, { error: { code: "LOGIN_REQUIRED", message: "Sign in." } });
    if (url === "/api/auth/challenge") return json(200, { message: "127.0.0.1 wants you to sign in" });
    if (url === "/api/auth/verify") { meResponse = { address: "0xabc0000000000000000000000000000000000def", chainId: 31337, expiresAt: "", chogs: [{ agentKey: REGENT, name: "Regent", faction: "crown", stance: "persona", joinedCycle: 0, ownershipEpoch: "3", control: "verified" }] }; return json(200, { address: "0xabc", csrfToken: "c".repeat(64) }); }
    if (method === "PUT") return json(putResponse.status, putResponse.body);
    return json(404, { error: { code: "NOT_FOUND", message: "no" } });
  }));
  sessionStorage.clear();
  soulState = { balance: "3", messages: [] };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (window as { ethereum?: unknown }).ethereum; });

describe("Chog Cult page", () => {
  it("shows the cycle, places, factions and every Chog from the snapshot", async () => {
    render(<App />);
    expect(await screen.findByText("Cycle 2")).toBeTruthy();
    expect(screen.getByText("Fixture Village")).toBeTruthy();
    expect(screen.getByRole("listitem", { current: "step" }).textContent).toBe("Debate");
    const places = screen.getByRole("region", { name: "Places" });
    expect(within(places).getByText("Golden Lanterns.")).toBeTruthy();
    expect(within(places).getByText("Neutral")).toBeTruthy();
    const table = screen.getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Regent" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Factions" }).textContent).toContain("The Chaos");
  });

  it("follows the live stream from the snapshot revision and labels scripted debate", async () => {
    render(<App />);
    await screen.findByText("Cycle 2");
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe("/api/cult/events?after=10");
    const feed = screen.getByRole("region", { name: "Council feed" });
    // Event text is rendered as text, never as HTML.
    expect(within(feed).getByText("Ember wants the <b>Tavern</b> loud!")).toBeTruthy();
    expect(within(feed).getByText("Scripted")).toBeTruthy();
    current = snapshot({ revision: "11", phase: "vote" });
    act(() => source.emit("phase_changed", event(11, "phase_changed", { phase: "vote" })));
    expect(await within(feed).findByText("Cycle 2: Vote phase begins.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("listitem", { current: "step" }).textContent).toBe("Vote"));
  });

  it("starts over from a fresh snapshot when the stream says reset", async () => {
    render(<App />);
    await screen.findByText("Cycle 2");
    current = snapshot({ revision: "500" });
    act(() => FakeEventSource.instances[0]!.emit("reset", { revision: "500" }));
    await waitFor(() => expect(FakeEventSource.instances.at(-1)!.url).toBe("/api/cult/events?after=500"));
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });
});

describe("owner panel", () => {
  async function signIn() {
    const request = vi.fn(async ({ method }: { method: string; params?: unknown[] }) => (method === "eth_requestAccounts" ? ["0xAbC0000000000000000000000000000000000DeF"] : `0x${"1".repeat(130)}`));
    (window as { ethereum?: unknown }).ethereum = { request };
    render(<App />);
    await screen.findByText("Cycle 2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in with wallet" }));
    await screen.findByRole("heading", { name: "Regent" });
    return request;
  }

  it("signs the server's message with personal_sign and opens the holder's Chogs", async () => {
    const request = await signIn();
    expect(calls.find((call) => call.url === "/api/auth/challenge")?.body).toEqual({ address: "0xAbC0000000000000000000000000000000000DeF", chainId: 31337 });
    const signCall = request.mock.calls.find(([args]) => args.method === "personal_sign")![0] as { params: string[] };
    expect(Buffer.from(signCall.params[0]!.slice(2), "hex").toString()).toBe("127.0.0.1 wants you to sign in");
    expect(sessionStorage.getItem("chog-cult-csrf")).toBe("c".repeat(64));
  });

  it("saves a faction change with the CSRF token, a fresh idempotency key and the ownership epoch", async () => {
    await signIn();
    await userEvent.selectOptions(screen.getByLabelText("Faction"), "chaos");
    expect(screen.getByText(/2-cycle wait/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const put = await waitFor(() => { const found = calls.find((call) => call.method === "PUT"); expect(found).toBeTruthy(); return found!; });
    expect(put.url).toBe(`/api/cult/members/${REGENT}`);
    expect(put.body).toEqual({ faction: "chaos", stance: "persona", expectedEpoch: "3" });
    expect(put.headers["x-csrf-token"]).toBe("c".repeat(64));
    expect(put.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await screen.findByText("Saved.")).getAttribute("role")).toBe("status");
  });

  it("explains a refusal from the server", async () => {
    await signIn();
    putResponse = { status: 409, body: { error: { code: "SWITCH_COOLDOWN", message: "This Chog changed faction recently; it can change again in cycle 4." } } };
    await userEvent.selectOptions(screen.getByLabelText("Faction"), "chaos");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("cycle 4");
  });

  it("offers vote overrides only during the Vote phase, for the current cycle", async () => {
    current = snapshot({ phase: "vote" });
    await signIn();
    await userEvent.selectOptions(screen.getByLabelText("Plaza"), "crown-parade");
    await userEvent.click(within(screen.getByLabelText("Plaza").parentElement!).getByRole("button", { name: "Vote" }));
    const put = await waitFor(() => { const found = calls.find((call) => call.method === "PUT"); expect(found).toBeTruthy(); return found!; });
    expect(put.url).toBe(`/api/cult/votes/2/${REGENT}/plaza`);
    expect(put.body).toEqual({ decreeId: "crown-parade", expectedEpoch: "3" });
  });
});
