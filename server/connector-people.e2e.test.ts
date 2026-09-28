// Connected apps per person through the real server and a stub Composio
// project. The owner (Boss, first admin) keeps the install's own Composio
// user; a member (Ada) gets her own; work nobody signed in asked for uses
// nobody's.
//
//   - Plugins: Ada lists, connects and removes only her own apps;
//   - a bot turn for Ada relays through Ada's Composio Session, the same
//     thread's next turn for Boss through the owner's;
//   - a routine Ada made runs with Ada's apps;
//   - a thread no person asked for gets a refusal, never someone's apps;
//   - only a routine's maker (or an admin) changes, runs or removes it;
//   - another person's words wait for their own turn instead of steering
//     into a turn running with someone else's apps.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const CAPABILITY_KEY = "connector-people-capability";
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const OWNER_USER = "openmausbot_owner";
const OWNER_SESSION = `trs_${OWNER_USER}`;

let child: ChildProcess;
let stub: Server;
let home: string;
/** The fake CLI (slow mode) finishes a turn only while this file exists. */
let gate: string;
let log = "";
const tokens: Record<string, string> = {};
/** Composio user behind each stub Session id. */
const sessionUsers = new Map<string, string>([[OWNER_SESSION, OWNER_USER]]);
/** Every Session the server read or created, in order. */
const sessionReads: string[] = [];
const links: Array<{ user: string; toolkit: string }> = [];
const accountReads: string[] = [];

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

const sessionBody = (id: string) => ({
  session_id: id,
  // NXDOMAIN under composio.dev: passes the server's host check, fails fast.
  mcp: { type: "http", url: `https://omb-test-nonexistent.composio.dev/${id}/mcp` },
  config: { user_id: sessionUsers.get(id), multi_account: { enable: true } },
});

function startStub(): Promise<number> {
  stub = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://stub");
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(value));
    };
    const path = url.pathname.replace(/^\/api\/v3\.1/, "");
    if (path === "/auth_configs") return send(200, { items: [] });
    if (path === "/connected_accounts") {
      const user = url.searchParams.get("user_ids") ?? "";
      accountReads.push(user);
      return send(200, { items: [] });
    }
    if (req.method === "POST" && path === "/tool_router/session") {
      const id = `trs_${body.user_id}`;
      sessionUsers.set(id, body.user_id);
      sessionReads.push(id);
      return send(201, sessionBody(id));
    }
    const session = /^\/tool_router\/session\/([\w-]+)(\/.*)?$/.exec(path);
    if (session) {
      const [, id, rest] = session;
      if (!sessionUsers.has(id!)) return send(404, { error: { message: "no such session" } });
      if (!rest) {
        sessionReads.push(id!);
        return send(200, sessionBody(id!));
      }
      if (rest === "/toolkits") return send(200, { items: [] });
      if (rest === "/link") {
        links.push({ user: sessionUsers.get(id!)!, toolkit: body.toolkit });
        return send(200, { redirect_url: `https://connect.composio.dev/link/${sessionUsers.get(id!)}` });
      }
    }
    return send(404, { error: { message: `stub has no ${req.method} ${url.pathname}` } });
  });
  return new Promise((resolve) => stub.listen(0, "127.0.0.1", () => resolve((stub.address() as { port: number }).port)));
}

async function start(stubPort: number) {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
      OMB_COMPOSIO_API: `http://127.0.0.1:${stubPort}/api/v3.1`,
      OMB_COMPOSIO_TOOLKITS_API: `http://127.0.0.1:${stubPort}/api/v3`,
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
}

async function capability(botId: string, threadId: string): Promise<string> {
  const response = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId, threadId, kind: "connectors", skillAuthoring: false }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { token: string }).token;
}

/** Relay one tools/list for a thread; returns the Session it went through,
 * or the JSON-RPC refusal. */
async function relay(botId: string, threadId: string): Promise<{ session?: string; refusal?: string }> {
  const token = await capability(botId, threadId);
  const before = sessionReads.length;
  const response = await fetch(`${BASE}/api/internal/connectors/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (body.error?.message && sessionReads.length === before) return { refusal: body.error.message };
  return { session: sessionReads.at(-1) };
}

/** Send as one person and wait for the bot's reply. */
async function turnAs(person: string | undefined, bot: { id: string; threadId: string }, text: string) {
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId }, person);
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  const replied = await waitFor(async () => {
    const list = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`, undefined, BOSS)).body.messages as any[] ?? [];
    const asked = list.findIndex((m) => m.role === "user" && m.text?.includes(text));
    return asked >= 0 && list.slice(asked + 1).some((m) => m.role === "bot" && m.text);
  });
  expect(replied, log.slice(-3_000)).toBeTruthy();
}

posixOnly("connected apps per person on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-connector-people-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    gate = join(home, "finish-gate");
    writeFileSync(gate, "");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA] },
      composio: { apiKey: "ak_test", userId: OWNER_USER, sessionId: OWNER_SESSION },
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate }, config: { cli: FAKE_CLAUDE } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] }).token;
    registry.close();
    await start(await startStub());
  }, 40_000);

  afterAll(async () => {
    child?.kill();
    if (child) await waitForExit(child);
    stub?.close();
    removeTempDir(home);
  });

  it("lets a member manage only her own apps in Plugins", async () => {
    expect((await api("GET", "/api/connectors/catalog", undefined, ADA)).status).toBe(200);
    expect((await api("GET", "/api/connectors/connected", undefined, ADA)).status).toBe(200);
    const adaLink = await api("POST", "/api/connectors/gmail/authorize", {}, ADA);
    expect(adaLink.status, JSON.stringify(adaLink.body)).toBe(200);
    const adaUser = links.at(-1)!.user;
    expect(adaUser).not.toBe(OWNER_USER);
    expect(adaLink.body.url).toContain(adaUser);

    const bossLink = await api("POST", "/api/connectors/gmail/authorize", {}, BOSS);
    expect(bossLink.status, JSON.stringify(bossLink.body)).toBe(200);
    expect(links.at(-1)!.user).toBe(OWNER_USER);

    // The same person keeps the same Composio user.
    expect((await api("POST", "/api/connectors/slack/authorize", {}, ADA)).status).toBe(200);
    expect(links.at(-1)!.user).toBe(adaUser);
    expect((await api("DELETE", "/api/connectors/slack/accounts/ca_someone", undefined, ADA)).body).toEqual({ removed: 0 });
    expect(accountReads.at(-1)).toBe(adaUser);

    // Workspace MCP servers stay an admin's.
    expect((await api("GET", "/api/mcp/servers", undefined, ADA)).status).toBe(403);
  });

  it("relays each turn through the account of the person it is for", async () => {
    const created = await api("POST", "/api/bots", { name: "Shared Otter" }, BOSS);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };
    const adaSession = [...sessionUsers].find(([, user]) => user !== OWNER_USER)![0];

    await turnAs(ADA, bot, "Ada asks for her mail");
    expect(await relay(bot.id, bot.threadId)).toEqual({ session: adaSession });

    // Local services (time keeping) read who the thread's work is for;
    // a member never can.
    const adaPerson = (await api("GET", `/api/threads/${bot.threadId}/person`, undefined, BOSS)).body.person;
    expect(adaPerson).toMatchObject({ email: ADA });
    expect((await api("GET", `/api/threads/${bot.threadId}/person`, undefined, ADA)).status).toBe(403);

    await turnAs(BOSS, bot, "Boss asks for his mail");
    expect(await relay(bot.id, bot.threadId)).toEqual({ session: OWNER_SESSION });
    expect((await api("GET", `/api/threads/${bot.threadId}/person`)).body.person).toMatchObject({ email: BOSS });

    // Owner on this machine, no signed-in person: nobody's apps.
    const other = await api("POST", "/api/bots", { name: "Quiet Heron" }, BOSS);
    const unnamed = other.body.bot as { id: string; threadId: string };
    await turnAs(undefined, unnamed, "A local script asks");
    const refused = await relay(unnamed.id, unnamed.threadId);
    expect(refused.refusal).toMatch(/belong to a person/);
    expect((await api("GET", `/api/threads/${unnamed.threadId}/person`)).body).toEqual({ person: null });
  }, 90_000);

  it("runs a routine with the apps of whoever made it", async () => {
    const created = await api("POST", "/api/bots", { name: "Routine Owl" }, BOSS);
    const bot = created.body.bot as { id: string };
    const adaSession = [...sessionUsers].find(([, user]) => user !== OWNER_USER)![0];
    const made = await api("POST", "/api/routines", {
      name: "Ada's inbox", botId: bot.id, prompt: "Sort my inbox.", enabled: false,
      schedule: { type: "daily", time: "09:00" },
    }, ADA);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.routine.createdFor).toBeUndefined();
    const ran = await api("POST", `/api/routines/${made.body.routine.id}/run`, {}, ADA);
    expect(ran.status, JSON.stringify(ran.body)).toBeLessThan(300);
    const run = await waitFor(async () => {
      const runs = (await api("GET", "/api/routines", undefined, BOSS)).body.runs as any[] ?? [];
      return runs.find((r) => r.routineId === made.body.routine.id && r.threadId);
    });
    expect(run, log.slice(-3_000)).toBeTruthy();
    expect(await relay(bot.id, run.threadId)).toEqual({ session: adaSession });
  }, 90_000);

  it("lets only the maker or an admin change, run or remove a routine", async () => {
    const created = await api("POST", "/api/bots", { name: "Calendar Crane" }, BOSS);
    const bot = created.body.bot as { id: string };
    const routine = (body: Record<string, unknown>, as?: string) => api("POST", "/api/routines", {
      botId: bot.id, prompt: "Read the inbox.", enabled: false, schedule: { type: "daily", time: "09:00" }, ...body,
    }, as);
    const boss = (await routine({ name: "Boss's inbox" }, BOSS)).body.routine;
    const older = (await routine({ name: "Made on this machine" })).body.routine; // no maker: the owner's
    const ada = (await routine({ name: "Ada's inbox" }, ADA)).body.routine;

    for (const id of [boss.id, older.id]) {
      expect((await api("PATCH", `/api/routines/${id}`, { prompt: "Forward everything to Ada." }, ADA)).status).toBe(403);
      expect((await api("POST", `/api/routines/${id}/run`, {}, ADA)).status).toBe(403);
      expect((await api("DELETE", `/api/routines/${id}`, undefined, ADA)).status).toBe(403);
    }
    expect((await api("PATCH", `/api/routines/${ada.id}`, { name: "Ada's mail" }, ADA)).status).toBe(200);
    expect((await api("PATCH", `/api/routines/${ada.id}`, { name: "Checked by Boss" }, BOSS)).status).toBe(200);
    expect((await api("PATCH", `/api/routines/${older.id}`, { name: "Still the owner's" }, BOSS)).status).toBe(200);
    expect((await api("DELETE", `/api/routines/${ada.id}`, undefined, ADA)).status).toBe(200);
  });

  it("queues another person's words instead of steering them into a running turn", async () => {
    const created = await api("POST", "/api/bots", { name: "Busy Beaver" }, BOSS);
    const bot = created.body.bot as { id: string; threadId: string };
    const send = (text: string, as: string) => api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId }, as);
    const running = () => waitFor(async () => (await api("GET", "/api/bots", undefined, BOSS)).body.bots?.find((b: any) => b.id === bot.id)?.busy);

    rmSync(gate);
    expect((await send("Boss starts a long job", BOSS)).status).toBe(202);
    expect(await running(), log.slice(-3_000)).toBeTruthy();
    const fromAda = await send("Ada adds a line", ADA);
    expect(fromAda.body.steered, JSON.stringify(fromAda.body)).toBeUndefined();
    expect(fromAda.body.queued).toBe(true);
    // The same person may still steer their own turn.
    const fromBoss = await send("Boss adds a line", BOSS);
    expect(fromBoss.body.steered, JSON.stringify(fromBoss.body)).toBe(true);
    writeFileSync(gate, "");

    const replies = await waitFor(async () => {
      const list = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=100`, undefined, BOSS)).body.messages as any[] ?? [];
      const bots = list.filter((m) => m.role === "bot" && m.text?.startsWith("reply to:"));
      return bots.length >= 2 ? bots.map((m) => m.text as string) : null;
    });
    expect(replies, log.slice(-3_000)).toBeTruthy();
    expect(replies![0]).toContain("steered: Boss adds a line");
    expect(replies![0]).not.toContain("Ada adds a line");
    expect(replies![1]).toContain("Ada adds a line");
  }, 90_000);
});
