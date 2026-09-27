// Facts from a memory service ride on the turn text of the bots that have it.
// A small HTTP service stands in for the memory service; the fake Claude CLI
// dumps the prompt it was given.
//
//   - a bot with the memory server gets the facts, a bot without it does not;
//   - the service gets the MCP server's own headers;
//   - a service that does not answer in time adds nothing and stops nothing.
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const PORT = 18800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const BOB = "bob@example.test";

let child: ChildProcess;
let home: string;
let dumpPath: string;
let log = "";
const tokens: Record<string, string> = {};

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

const dumpedPrompt = (): string | null => {
  if (!existsSync(dumpPath)) return null;
  // The prompt is the stream-json turn the CLI read; its text is somewhere inside.
  try { const prompt = JSON.parse(readFileSync(dumpPath, "utf8")).prompt; return prompt ? JSON.stringify(prompt) : null; } catch { return null; }
};

/** Send as one person and return the prompt the engine was given. */
async function turnAs(person: string, bot: { id: string; threadId: string }, text: string) {
  rmSync(dumpPath, { force: true });
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId }, person);
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const prompt = await waitFor(dumpedPrompt);
  expect(prompt, log.slice(-3_000)).not.toBeNull();
  await waitFor(async () => {
    const list = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`, undefined, BOSS)).body.messages as any[] ?? [];
    const asked = list.findIndex((m) => m.role === "user" && m.text?.includes(text));
    return asked >= 0 && list.slice(asked + 1).some((m) => m.role === "bot" && m.text);
  });
  return prompt!;
}

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const up = await waitFor(async () => {
    try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
  }, 20_000);
  if (!up) throw new Error(`server never came up:\n${log}`);
}

posixOnly("memory recall on the turns of the bots that have it", () => {
  let memory: Server;
  let memoryPort = 0;
  let seenAuth = "";
  let slow = false;

  beforeAll(async () => {
    memory = createServer((req, res) => {
      seenAuth = String(req.headers.authorization ?? "");
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const query = JSON.parse(body || "{}").query ?? "";
        const reply = () => res.writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ text: `- Donovan books the delivery slots (asked: ${String(query).slice(0, 20)})` }));
        if (slow) setTimeout(reply, 5_000); else reply();
      });
    });
    await new Promise<void>((resolve) => memory.listen(0, "127.0.0.1", resolve));
    memoryPort = (memory.address() as { port: number }).port;

    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-memory-recall-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    dumpPath = join(home, "fake-claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dumpPath }, config: { cli: FAKE_CLAUDE } } },
      mcpServers: {
        memo: { type: "http", url: `http://127.0.0.1:${memoryPort}/mcp`, recall: `http://127.0.0.1:${memoryPort}/recall`,
          headers: { Authorization: "Bearer ripal-token" } },
      },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA, BOB]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] }).token;
    registry.close();
    await start();
  }, 40_000);

  afterAll(async () => {
    child?.kill();
    if (child) await waitForExit(child);
    memory?.close();
    removeTempDir(home);
  });

  it("gives the facts to a bot that has the memory server, with its headers, and not to one without", async () => {
    const withMemory = (await api("POST", "/api/bots", { name: "Remembering Wren" }, BOSS)).body.bot as { id: string; threadId: string };
    expect((await api("PATCH", `/api/bots/${withMemory.id}`, { mcpServers: ["memo"] }, BOSS)).status).toBe(200);
    const without = (await api("POST", "/api/bots", { name: "Forgetful Wren" }, BOSS)).body.bot as { id: string; threadId: string };
    expect((await api("PATCH", `/api/bots/${without.id}`, { mcpServers: [] }, BOSS)).status).toBe(200);

    const remembered = await turnAs(ADA, withMemory, "Who books the delivery slots?");
    expect(remembered).toContain("Donovan books the delivery slots");
    expect(remembered).toContain("Memory from memo");
    expect(seenAuth).toBe("Bearer ripal-token");

    const plain = await turnAs(ADA, without, "Who books the delivery slots again?");
    expect(plain).not.toContain("Donovan");
  }, 90_000);

  it("keeps a recall address given when the server is added", async () => {
    const added = await api("POST", "/api/mcp/servers", { name: "memo2", type: "http", url: `http://127.0.0.1:${memoryPort}/mcp`,
      recall: `http://127.0.0.1:${memoryPort}/recall`, headers: { Authorization: "Bearer other" } }, BOSS);
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    const listed = (added.body.servers as Array<{ name: string; recall?: string }>).find((s) => s.name === "memo2");
    expect(listed?.recall).toBe(`http://127.0.0.1:${memoryPort}/recall`);
  });

  it("does not hold a turn for a memory service that does not answer in time", async () => {
    slow = true;
    const bot = (await api("POST", "/api/bots", { name: "Patient Wren" }, BOSS)).body.bot as { id: string; threadId: string };
    expect((await api("PATCH", `/api/bots/${bot.id}`, { mcpServers: ["memo"] }, BOSS)).status).toBe(200);
    const started = Date.now();
    const prompt = await turnAs(ADA, bot, "Anything about slots?");
    expect(prompt).not.toContain("Donovan");
    expect(Date.now() - started).toBeLessThan(15_000);
    slow = false;
  }, 60_000);
});
