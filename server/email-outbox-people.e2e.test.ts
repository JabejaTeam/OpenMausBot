// Email cards on a shared workspace (fork): only the signed-in person the
// conversation is for (or an admin) answers a card. A loopback caller — which
// every bot's shell is — never sends someone's mail.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPABILITY_KEY = "email-people-capability";
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const NOOR = "noor@example.test";
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess;
let stub: Server;
let home: string;
let log = "";
const tokens: Record<string, string> = {};
const sends: Array<Record<string, unknown>> = [];

const api = async (method: string, path: string, body?: unknown, as?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(as ? { authorization: `Bearer ${tokens[as]}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

async function waitFor<T>(read: () => Promise<T | null | undefined> | T | null | undefined, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

function startStub(): Promise<number> {
  stub = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const frame = raw ? JSON.parse(raw) : {};
    if (frame.id === undefined) return void res.writeHead(202).end();
    const reply = (result: unknown) => {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "stub" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
    };
    if (frame.method !== "tools/call") return reply({ protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "stub", version: "1" } });
    const tools = frame.params.arguments.tools ?? [{ tool_slug: frame.params.name, arguments: frame.params.arguments }];
    const results = tools.map((tool: { tool_slug: string; arguments: Record<string, unknown> }, index: number) => {
      if (tool.tool_slug === "GMAIL_SEND_EMAIL") sends.push(tool.arguments);
      const data = tool.tool_slug === "GMAIL_GET_PROFILE" ? { emailAddress: ADA } : tool.tool_slug === "GMAIL_SETTINGS_SEND_AS_GET" ? { signature: "<b>Ada</b>" } : { id: "m1" };
      return { response: { successful: true, data }, tool_slug: tool.tool_slug, index };
    });
    reply({ content: [{ type: "text", text: JSON.stringify({ data: { results }, successful: true }) }] });
  });
  return new Promise((resolve) => stub.listen(0, "127.0.0.1", () => resolve((stub.address() as { port: number }).port)));
}

posixOnly("email cards on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-email-people-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, NOOR] },
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "happy" }, config: { cli: FAKE_CLAUDE } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA, NOOR]) tokens[email] = registry.issue({ label: email, email, scopes: [...role(email)] }).token;
    registry.close();
    const stubPort = await startStub();
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
        OMB_COMPOSIO_BROKER_URL: `http://127.0.0.1:${stubPort}`,
        OMB_COMPOSIO_BROKER_TOKEN: "b".repeat(64),
        OMB_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const up = await waitFor(async () => {
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    }, 20_000);
    if (!up) throw new Error(`server never came up:\n${log}`);
  }, 40_000);

  afterAll(async () => {
    child?.kill();
    if (child) await waitForExit(child);
    stub?.close();
    removeTempDir(home);
  });

  it("lets only the person it is for, or an admin, answer the card", async () => {
    const bot = (await api("POST", "/api/bots", { name: "Shared Wren" }, BOSS)).body.bot as { id: string; threadId: string };
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Mail the supplier", threadId: bot.threadId }, ADA)).status).toBe(202);
    const listed = async () => (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`, undefined, BOSS)).body.messages as any[] ?? [];
    expect(await waitFor(async () => (await listed()).some((m) => m.role === "bot" && m.text)), log.slice(-3_000)).toBeTruthy();

    const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
      body: JSON.stringify({ botId: bot.id, threadId: bot.threadId, kind: "connectors", skillAuthoring: false }),
    });
    const { token } = await minted.json() as { token: string };
    await fetch(`${BASE}/api/internal/connectors/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "sales@supplier.test", subject: "Order", body: "Hi" } } }),
    });
    const card = (await listed()).find((m) => m.kind === "email");
    expect(card?.email?.signature).toBe("<b>Ada</b>");
    const send = (as?: string) => api("POST", `/api/bots/${bot.id}/email-cards/${card.id}/send`, { threadId: bot.threadId }, as);

    expect((await send()).status).toBe(403); // a loopback caller, like a bot's shell
    expect((await send(NOOR)).status).toBe(403); // another member
    expect(sends).toEqual([]);
    expect(await send(ADA)).toMatchObject({ status: 200, body: { status: "sent" } });
    expect(sends).toHaveLength(1);
  }, 90_000);
});
