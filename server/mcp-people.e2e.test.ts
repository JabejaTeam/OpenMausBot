// Per-person MCP values through the real server and the fake Claude CLI,
// which dumps the MCP config it was spawned with. One bot, one thread, three
// people taking turns: an admin (Boss), a listed member (Ada) and an unlisted
// member (Bob).
//
//   - jabeja (URL server): Ada's turn carries Ada's token, Boss and Bob fall
//     back to the shared token;
//   - billit (people-only command server): mounted for Boss alone;
//   - the listing never returns a value.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_MCP = join(SERVER_DIR, "testing", "fake-mcp-server.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
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

type Mounted = Record<string, { headers?: Record<string, string> }>;
const mounted = (): Mounted | null => {
  if (!existsSync(dumpPath)) return null;
  try { return (JSON.parse(readFileSync(dumpPath, "utf8")).mcpConfig?.mcpServers ?? null) as Mounted | null; } catch { return null; }
};

/** Send as one person and return the MCP servers the engine was spawned with. */
async function turnAs(person: string, bot: { id: string; threadId: string }, text: string) {
  rmSync(dumpPath, { force: true });
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId }, person);
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const servers = await waitFor(mounted);
  expect(servers, log.slice(-3_000)).not.toBeNull();
  await waitFor(async () => {
    const list = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`, undefined, BOSS)).body.messages as any[] ?? [];
    const asked = list.findIndex((m) => m.role === "user" && m.text?.includes(text));
    return asked >= 0 && list.slice(asked + 1).some((m) => m.role === "bot" && m.text);
  });
  return servers!;
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

posixOnly("per-person MCP values on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-mcp-people-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    dumpPath = join(home, "fake-claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dumpPath }, config: { cli: FAKE_CLAUDE } } },
      mcpServers: {
        jabeja: { type: "http", url: "https://mcp.example.test/mcp", headers: { Authorization: "Bearer shared-bots" },
          people: { [ADA]: { Authorization: "Bearer ada-own" } } },
        billit: { command: process.execPath, args: ["--experimental-strip-types", FAKE_MCP], env: { BILLIT_ENV: "production" },
          peopleOnly: true, people: { [BOSS]: { BILLIT_API_KEY: "boss-key" } } },
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
    removeTempDir(home);
  });

  it("mounts each person's own values for the turns done for them", async () => {
    const created = await api("POST", "/api/bots", { name: "Shared Otter" }, BOSS);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };

    const ada = await turnAs(ADA, bot, "Ada asks for her tasks");
    expect(ada.jabeja?.headers?.Authorization).toBe("Bearer ada-own");
    expect(ada.billit).toBeUndefined();

    const boss = await turnAs(BOSS, bot, "Boss prepares an invoice");
    expect(boss.jabeja?.headers?.Authorization).toBe("Bearer shared-bots");
    expect(boss.billit).toBeDefined();

    const bob = await turnAs(BOB, bot, "Bob asks the same bot");
    expect(bob.jabeja?.headers?.Authorization).toBe("Bearer shared-bots");
    expect(bob.billit).toBeUndefined();
  }, 90_000);

  it("lists who has their own values without ever returning one", async () => {
    const listing = await api("GET", "/api/mcp/servers", undefined, BOSS);
    expect(listing.status).toBe(200);
    const text = JSON.stringify(listing.body);
    expect(text).toContain(ADA);
    expect(text).not.toContain("ada-own");
    expect(text).not.toContain("boss-key");
    expect(text).not.toContain("shared-bots");
    expect((await api("GET", "/api/mcp/servers", undefined, ADA)).status).toBe(403);
  });
});
