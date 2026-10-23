// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SoulPage } from "./SoulPage";
import { soulResponse } from "./fakeSoulApi";

const ME = "0xabc0000000000000000000000000000000000def";
const BASE = "143:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432:0x4a8d56dcadb3bd4f8d9776e9e6f6211b845c6b02:0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763";
const TX = `0x${"ab".repeat(32)}`;

interface Call { method: string; url: string; body: Record<string, unknown> | undefined; headers: Record<string, string> }

function server(options: { awakening?: boolean; joinFull?: boolean } = {}) {
  const state = { signedIn: false, awake7: false, joined7: false, tokenChecks: 0, balance: "50", messages: [] as { role: "holder" | "chog"; text: string; createdAt: string }[], calls: [] as Call[] };
  const chogs = () => [
    { tokenId: "1", name: "Regent", image: "https://img.test/1.webp", awakened: true, agentKey: `${BASE}:1:101`, inCult: true, inCity: true, plotId: "p03" },
    {
      tokenId: "7", name: "Chog #7", image: "https://img.test/7.webp", awakened: state.awake7, agentKey: state.awake7 ? `${BASE}:7:4107` : null,
      inCult: state.joined7, inCity: state.joined7 && !options.joinFull, plotId: state.joined7 && !options.joinFull ? "p09" : null,
    },
  ];
  const json = (status: number, value: unknown) => new Response(JSON.stringify(value), { status });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    state.calls.push({ method, url, body, headers: (init.headers ?? {}) as Record<string, string> });
    if (url === "/api/cult/config") return json(200, { mode: "live", label: "Monad mainnet", chainIds: [143], login: true, city: true });
    if (url === "/api/auth/challenge") return json(200, { message: "cult.test wants you to sign in" });
    if (url === "/api/auth/verify") { state.signedIn = true; return json(200, { address: ME, csrfToken: "c".repeat(64) }); }
    if (url === "/api/soul/holdings") {
      return state.signedIn ? json(200, { address: ME, blockNumber: "9", awakening: options.awakening ?? true, chogs: chogs() })
        : json(401, { error: { code: "LOGIN_REQUIRED", message: "Sign in with your wallet first." } });
    }
    if (url === "/api/soul/awaken/7") return json(200, { chainId: 143, to: "0x4a8d56dcadb3bd4f8d9776e9e6f6211b845c6b02", data: "0xdeadbeef", agentURI: "data:application/json;base64,e30=" });
    if (url === "/api/soul/tokens/7") {
      // The server sees the awakening one read after the receipt: it reads the finalized chain.
      state.tokenChecks += 1;
      const awake = state.awake7 && state.tokenChecks >= 2;
      return json(200, { tokenId: "7", awakened: awake, agentKey: awake ? `${BASE}:7:4107` : null });
    }
    if (url === "/api/city/admissions" && method === "POST") {
      state.joined7 = true;
      return options.joinFull
        ? json(409, { error: { code: "CITY_FULL", message: "Every plot in City is taken, so Chog #7 can't move in yet. It joined Chog Cult and Chog Soul." } })
        : json(200, { agent: {} });
    }
    const soul = soulResponse(url, method, state);
    if (soul !== undefined) return json(200, soul);
    throw new Error(`Unexpected ${method} ${url}`);
  }));
  return state;
}

function wallet(state: ReturnType<typeof server>, options: { cancel?: boolean } = {}) {
  let chain = "0x1";
  let receipts = 0;
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    switch (method) {
      case "eth_requestAccounts": return [ME.toUpperCase().replace("0X", "0x")];
      case "personal_sign": return "0xsig";
      case "eth_chainId": return chain;
      case "wallet_switchEthereumChain": throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      case "wallet_addEthereumChain": chain = (params![0] as { chainId: string }).chainId; return null;
      case "eth_sendTransaction":
        if (options.cancel) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
        state.awake7 = true;
        return TX;
      case "eth_getTransactionReceipt": receipts += 1; return receipts < 2 ? null : { status: "0x1" };
    }
    throw new Error(`Unexpected wallet call ${method}`);
  });
  window.ethereum = { request };
  return request;
}

const noWait = async () => {};

async function signIn() {
  const user = userEvent.setup();
  render(<SoulPage sleep={noWait} />);
  await user.click(await screen.findByRole("button", { name: "Sign in with wallet" }));
  await screen.findByRole("heading", { name: /Your Chogs/ });
  return user;
}

beforeEach(() => {
  window.history.replaceState(null, "", "/soul/");
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.ethereum;
});

describe("Chog Soul page", () => {
  it("signs in and lists the wallet's Chogs with where each one is, then shows an awake Chog's Soul", async () => {
    server();
    wallet(server());
    await signIn();
    const grid = screen.getByRole("heading", { name: /Your Chogs/ }).closest("section")!;
    expect(within(grid).getByRole("button", { name: /^Regent/ }).textContent).toContain("In City · plot 3");
    expect(within(grid).getByRole("button", { name: /^Chog #7/ }).textContent).toContain("Asleep");
    expect(await screen.findByText("“By decree of the crown!”")).toBeTruthy();
    expect(screen.getByRole("link", { name: "See Regent in City →" }).getAttribute("href")).toBe("/city/?chog=1");
    expect(await screen.findByRole("heading", { name: "Talk to Regent" })).toBeTruthy();
  });

  it("awakens a sleeping Chog from the holder's wallet on Monad, then brings it into Chog World", async () => {
    const state = server();
    const request = wallet(state);
    const user = await signIn();
    await user.click(screen.getByRole("button", { name: /^Chog #7/ }));
    expect(window.location.search).toBe("?chog=7");
    await user.click(screen.getByRole("button", { name: "Awaken Chog #7" }));
    expect(await screen.findByText("Chog #7 is awake and has joined Chog World.")).toBeTruthy();

    const methods = request.mock.calls.map(([call]) => call.method);
    expect(methods).toEqual(expect.arrayContaining(["wallet_switchEthereumChain", "wallet_addEthereumChain", "eth_sendTransaction"]));
    expect(request.mock.calls.find(([call]) => call.method === "wallet_addEthereumChain")![0].params![0]).toMatchObject({ chainId: "0x8f", chainName: "Monad" });
    expect(request.mock.calls.find(([call]) => call.method === "eth_sendTransaction")![0].params![0])
      .toEqual({ from: ME.toUpperCase().replace("0X", "0x"), to: "0x4a8d56dcadb3bd4f8d9776e9e6f6211b845c6b02", data: "0xdeadbeef" });
    const join = state.calls.find((call) => call.url === "/api/city/admissions")!;
    expect(join).toMatchObject({ method: "POST", body: { tokenId: "7" }, headers: { "x-csrf-token": "c".repeat(64) } });
    expect(state.tokenChecks).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Chog #7/ }).textContent).toContain("In City · plot 9"));
  });

  it("says so when City is full, and the Chog lives in the Cult", async () => {
    const state = server({ joinFull: true });
    wallet(state);
    const user = await signIn();
    await user.click(screen.getByRole("button", { name: /^Chog #7/ }));
    await user.click(screen.getByRole("button", { name: "Awaken Chog #7" }));
    expect(await screen.findByText(/Every plot in City is taken, so Chog #7 can't move in yet/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Chog #7/ }).textContent).toContain("In the Cult"));
  });

  it("sends nothing when the holder cancels in the wallet", async () => {
    const state = server();
    wallet(state, { cancel: true });
    const user = await signIn();
    await user.click(screen.getByRole("button", { name: /^Chog #7/ }));
    await user.click(screen.getByRole("button", { name: "Awaken Chog #7" }));
    expect((await screen.findByRole("alert")).textContent).toContain("You cancelled it in your wallet. Nothing was sent.");
    expect(state.calls.some((call) => call.url === "/api/city/admissions")).toBe(false);
  });

  it("brings an awake Chog that hasn't joined yet into Chog World", async () => {
    const state = server();
    state.awake7 = true; // awakened elsewhere, never joined
    wallet(state);
    const user = await signIn();
    await user.click(screen.getByRole("button", { name: /^Chog #7/ }));
    expect(screen.getByRole("button", { name: /^Chog #7/ }).textContent).toContain("Awake, not joined yet");
    await user.click(screen.getByRole("button", { name: "Bring Chog #7 into Chog World" }));
    expect(await screen.findByText("Chog #7 has joined Chog World.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Chog #7/ }).textContent).toContain("In City · plot 9"));
  });

  it("can't awaken on the local fixture server", async () => {
    const state = server({ awakening: false });
    wallet(state);
    const user = await signIn();
    await user.click(screen.getByRole("button", { name: /^Chog #7/ }));
    expect(screen.getByText(/Awakening needs the live Monad server/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Awaken Chog #7" })).toBeNull();
  });
});
