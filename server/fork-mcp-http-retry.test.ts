// Fork: the remote MCP client survives a gateway hiccup at the handshake
// and a server that forgot its session (mcp.jabeja.be, 2026-10-19: a 502 at
// initialize left a bot without the server's tools for a whole turn).
import { describe, expect, it, vi } from "vitest";

import { McpHttpError, McpRpcError, RemoteMcpClient } from "./mcp-http.ts";

/** A streamable HTTP server as fetch: answers in JSON, hands out sessions,
 * and fails the way it is told to. */
function fakeServer(options: { failInitialize?: number[] } = {}) {
  const failInitialize = [...(options.failInitialize ?? [])];
  const sessions = new Set<string>();
  const methods: string[] = [];
  let next = 0;
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "DELETE") return new Response(null, { status: 200 });
    const frame = JSON.parse(String(init?.body)) as { id?: number; method: string };
    const session = new Headers(init?.headers).get("mcp-session-id");
    methods.push(frame.method);
    if (frame.method === "initialize") {
      const status = failInitialize.shift();
      if (status) return new Response("Bad Gateway", { status });
      const id = `s${++next}`;
      sessions.add(id);
      return Response.json({ jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18" } }, { headers: { "mcp-session-id": id } });
    }
    if (!session || !sessions.has(session)) return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: "Session expired or invalid" }, id: null }, { status: 404 });
    if (frame.id === undefined) return new Response(null, { status: 202 });
    return Response.json({ jsonrpc: "2.0", id: frame.id, result: { session } });
  }) as typeof fetch;
  return { fetchImpl, sessions, methods };
}

const spec = { type: "http" as const, url: "https://mcp.example.test/mcp", headers: {} };

describe("the handshake", () => {
  it("tries again after a 502 or 503 from the gateway", async () => {
    const server = fakeServer({ failInitialize: [502, 503] });
    const client = new RemoteMcpClient(spec, { fetch: server.fetchImpl });
    await client.initialize("fixture", AbortSignal.timeout(10_000));
    expect(await client.request("tools/list", {}, AbortSignal.timeout(5_000))).toEqual({ session: "s1" });
  });

  it("gives up on a refusal that another try will not change", async () => {
    const server = fakeServer({ failInitialize: [403] });
    const client = new RemoteMcpClient(spec, { fetch: server.fetchImpl });
    const failure = await client.initialize("fixture", AbortSignal.timeout(5_000)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(McpHttpError);
    expect(failure).toMatchObject({ status: 403 });
    expect(server.methods).toEqual(["initialize"]);
  });
});

describe("a session the server no longer knows", () => {
  it("is opened again, and the request that met the 404 is sent once more", async () => {
    const server = fakeServer();
    const client = new RemoteMcpClient(spec, { fetch: server.fetchImpl });
    await client.initialize("fixture", AbortSignal.timeout(5_000));
    server.sessions.clear(); // evicted upstream
    const results = await Promise.all([
      client.request("tools/call", { name: "a" }, AbortSignal.timeout(5_000)),
      client.request("tools/call", { name: "b" }, AbortSignal.timeout(5_000)),
    ]);
    expect(results).toEqual([{ session: "s2" }, { session: "s2" }]);
    // one new handshake for both requests
    expect(server.methods.filter((method) => method === "initialize")).toHaveLength(2);
  });
});

describe("a rate-limited request", () => {
  it("is sent again after a 429 and after a JSON-RPC rate-limit answer, and runs once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const answers = [
        () => Response.json({ jsonrpc: "2.0", error: { code: -32029, message: "Rate limit exceeded — retry later" }, id: null }, { status: 429, headers: { "retry-after": "40" } }),
        (id: number) => Response.json({ jsonrpc: "2.0", id, error: { code: -32029, message: "Rate limit exceeded — retry later" } }),
      ];
      let calls = 0;
      const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
        const frame = JSON.parse(String(init?.body)) as { id: number; method: string };
        if (frame.method === "initialize") return Response.json({ jsonrpc: "2.0", id: frame.id, result: {} }, { headers: { "mcp-session-id": "s" } });
        if (frame.id === undefined) return new Response(null, { status: 202 });
        calls++;
        const answer = answers.shift();
        return answer ? answer(frame.id) : Response.json({ jsonrpc: "2.0", id: frame.id, result: { ran: calls } });
      }) as typeof fetch;
      const client = new RemoteMcpClient(spec, { fetch: fetchImpl });
      await client.initialize("fixture", new AbortController().signal);
      const pending = client.request("tools/call", { name: "x" }, new AbortController().signal);
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ ran: 3 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("is not sent again after another server error", async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const frame = JSON.parse(String(init?.body)) as { id: number; method: string };
      if (frame.method === "initialize") return Response.json({ jsonrpc: "2.0", id: frame.id, result: {} }, { headers: { "mcp-session-id": "s" } });
      if (frame.id === undefined) return new Response(null, { status: 202 });
      calls++;
      return Response.json({ jsonrpc: "2.0", id: frame.id, error: { code: -32602, message: "Invalid arguments" } });
    }) as typeof fetch;
    const client = new RemoteMcpClient(spec, { fetch: fetchImpl });
    await client.initialize("fixture", AbortSignal.timeout(5_000));
    await expect(client.request("tools/call", { name: "x" }, AbortSignal.timeout(5_000))).rejects.toBeInstanceOf(McpRpcError);
    expect(calls).toBe(1);
  });
});
