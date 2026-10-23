import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { HttpJsonRpc, RpcError } from "../../src/chain/rpc.js";

type Handler = (body: { id: number; method: string }, response: http.ServerResponse) => void;
const servers: http.Server[] = [];
const clients: HttpJsonRpc[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});

async function rpcServer(handler: Handler, options: { timeoutMs?: number; maxResponseBytes?: number } = {}) {
  const server = http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => handler(JSON.parse(Buffer.concat(chunks).toString("utf8")), response));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new HttpJsonRpc({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v2/SECRET-KEY?token=SECRET`, ...options });
  clients.push(client);
  return client;
}

const json = (response: http.ServerResponse, value: unknown, status = 200) => response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));

async function failure(promise: Promise<unknown>): Promise<RpcError> {
  const error = await promise.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(RpcError);
  expect((error as Error).message).not.toMatch(/SECRET|v2|token=/);
  return error as RpcError;
}

describe("owned JSON-RPC transport", () => {
  it("returns results and classifies reverts apart from other errors", async () => {
    const rpc = await rpcServer((body, response) => {
      if (body.method === "eth_chainId") json(response, { jsonrpc: "2.0", id: body.id, result: "0x8f" });
      else if (body.method === "eth_call") json(response, { jsonrpc: "2.0", id: body.id, error: { code: 3, message: "execution reverted", data: "0x7b65190b" } });
      else json(response, { jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "Block requested not found" } });
    });
    expect(await rpc.request("eth_chainId", [])).toBe("0x8f");
    expect(await failure(rpc.request("eth_call", []))).toMatchObject({ failure: "reverted", code: 3, data: "0x7b65190b", method: "eth_call" });
    const other = await failure(rpc.request("eth_getCode", []));
    expect(other).toMatchObject({ failure: "error_response", code: -32602 });
    expect(other.message).toBe("RPC 127.0.0.1 eth_getCode returned an error -32602: Block requested not found");
  });

  it("enforces its deadline and closes the connection", async () => {
    const rpc = await rpcServer(() => { /* never answers */ }, { timeoutMs: 50 });
    const error = await failure(rpc.request("eth_blockNumber", []));
    expect(error.message).toMatch(/eth_blockNumber timed out after 50ms/);
  });

  it("bounds the response size", async () => {
    const rpc = await rpcServer((body, response) => json(response, { jsonrpc: "2.0", id: body.id, result: `0x${"00".repeat(4096)}` }), { maxResponseBytes: 1024 });
    expect((await failure(rpc.request("eth_getCode", []))).message).toMatch(/exceeded 1024 bytes/);
  });

  it("rejects HTTP errors, non-JSON and replies to another request without retrying", async () => {
    let calls = 0;
    const rpc = await rpcServer((body, response) => {
      calls += 1;
      if (body.method === "eth_getLogs") json(response, { jsonrpc: "2.0", id: body.id, error: { code: -32614, message: "eth_getLogs is limited to a 100 range" } }, 413);
      else if (body.method === "eth_chainId") response.writeHead(200).end("<html>busy</html>");
      else json(response, { jsonrpc: "2.0", id: body.id + 1, result: "0x1" });
    });
    expect((await failure(rpc.request("eth_getLogs", [{}]))).message).toBe("RPC 127.0.0.1 eth_getLogs returned HTTP 413 (eth_getLogs is limited to a 100 range); not retried.");
    expect((await failure(rpc.request("eth_chainId", []))).message).toMatch(/not JSON/);
    expect((await failure(rpc.request("eth_blockNumber", []))).message).toMatch(/malformed JSON-RPC response/);
    expect(calls).toBe(3);
  });

  it("fails requests in flight when closed, and refuses new ones", async () => {
    const rpc = await rpcServer(() => { /* never answers */ }, { timeoutMs: 5_000 });
    const pending = failure(rpc.request("eth_blockNumber", []));
    await new Promise((resolve) => setTimeout(resolve, 20));
    rpc.close();
    expect((await pending).failure).toBe("transport");
    expect((await failure(rpc.request("eth_blockNumber", []))).message).toMatch(/connection is closed/);
  });

  it("refuses credentials over plain HTTP and non-HTTP URLs", () => {
    expect(() => new HttpJsonRpc({ url: "http://user:pass@rpc.example/" })).toThrow(/credentials require HTTPS/);
    expect(() => new HttpJsonRpc({ url: "ws://rpc.example/" })).toThrow(/HTTP\(S\)/);
    expect(new HttpJsonRpc({ url: "https://rpc.example/v2/key" }).host).toBe("rpc.example");
  });
});
