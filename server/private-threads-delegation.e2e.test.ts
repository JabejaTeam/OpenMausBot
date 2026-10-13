// Jabeja fork: work a bot hands a teammate stays private to the person it is
// for (server/thread-access.ts). Miguel (member) asks the Manager in his own
// conversation; the Manager hands it to Logistiek with coordinate_bots. The
// work thread on Logistiek is Miguel's: Logi, a member who works with
// Logistiek every day, neither sees it nor gets it in her own turns' Recent
// work brief; the admin sees it; Miguel's own later turn does get it.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const MIGUEL = "miguel@example.test";
const LOGI = "logistics@example.test";
const SECRET = "MIGUEL-PALLETS-42";

let child: ChildProcess;
let home: string;
let planPath: string;
let log = "";
const tokens: Record<string, string> = {};

const api = async (method: string, path: string, body: unknown, as: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), authorization: `Bearer ${tokens[as]}` },
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

const evidence = (): any[] => existsSync(`${planPath}.evidence.jsonl`)
  ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
const turnIn = (threadId: string) => waitFor(() => evidence().find((entry) => entry.threadId === threadId));
const context = (turn: any) => `${turn.system ?? ""}\n${JSON.stringify(turn.prompt)}`;

const ids = { manager: "", logistiek: "", work: "" };
const botAs = async (as: string, id: string) => (await api("GET", "/api/bots?messages=20", undefined, as)).body.bots.find((bot: any) => bot.id === id);
async function ownTurn(as: string, botId: string, text: string): Promise<string> {
  const task = await api("POST", `/api/bots/${botId}/tasks`, { title: `${as.split("@")[0]}'s` }, as);
  expect(task.status, JSON.stringify(task.body)).toBe(201);
  const threadId = task.body.task.threadId as string;
  expect((await api("POST", `/api/bots/${botId}/messages`, { text, threadId }, as)).status).toBe(202);
  return threadId;
}

posixOnly("delegated work stays with the person it is for", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-private-delegation-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    planPath = join(home, "room-plan.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [MIGUEL, LOGI] },
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_ROOM_PLAN: planPath }, config: { cli: FAKE_CLAUDE } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, MIGUEL, LOGI]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] }).token;
    registry.close();
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    expect(await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok, 20_000), log).toBe(true);

    ids.manager = (await api("POST", "/api/bots", { name: "Manager" }, BOSS)).body.bot.id;
    ids.logistiek = (await api("POST", "/api/bots", { name: "Logistiek", section: "Ops" }, BOSS)).body.bot.id;
    const patched = await api("PATCH", `/api/bots/${ids.manager}`, { chiefOfStaff: true, managedSections: ["Ops"], acknowledgePeerScope: true }, BOSS);
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    writeFileSync(planPath, JSON.stringify({
      [ids.manager]: { steps: [{ arguments: { bot_ids: [ids.logistiek], request_key: "pallets", message: `Count the pallets for ${SECRET}` } }],
        reply: "Sent to Logistiek", resumeReply: "Pallets counted" },
      [ids.logistiek]: { reply: `Counted: ${SECRET} has 12 pallets` },
    }));

    const miguelThread = await ownTurn(MIGUEL, ids.manager, "How many pallets do I have?");
    const work = await waitFor(() => evidence().find((entry) => entry.botId === ids.logistiek));
    expect(work, log.slice(-3_000)).not.toBeNull();
    ids.work = work.threadId;
    expect(ids.work).not.toBe(miguelThread);
    // the result is in Logistiek's work thread before anyone looks for it
    expect(await waitFor(async () => {
      const { body } = await api("GET", `/api/threads/${ids.work}/messages`, undefined, MIGUEL);
      return (body.messages ?? []).some((m: any) => m.role === "bot" && m.text?.includes("12 pallets"));
    }), log.slice(-3_000)).toBe(true);
  }, 120_000);

  afterAll(async () => {
    child?.kill();
    if (child) await waitForExit(child);
    removeTempDir(home);
  });

  it("gives the work thread to Miguel, not to whoever can see the bot", async () => {
    expect((await botAs(MIGUEL, ids.logistiek)).tasks.find((task: any) => task.threadId === ids.work)?.access).toBe("own");
    expect((await botAs(LOGI, ids.logistiek)).tasks.map((task: any) => task.threadId)).not.toContain(ids.work);
    expect((await api("GET", `/api/threads/${ids.work}/messages`, undefined, LOGI)).status).toBe(404);
    expect(JSON.stringify((await api("GET", `/api/search?q=${SECRET}`, undefined, LOGI)).body)).not.toContain(SECRET);
    expect((await botAs(BOSS, ids.logistiek)).tasks.find((task: any) => task.threadId === ids.work)?.access).toBe("team");
    expect((await api("GET", `/api/threads/${ids.work}/messages`, undefined, BOSS)).status).toBe(200);
  });

  it("keeps it out of a teammate's turns, and in Miguel's own", async () => {
    writeFileSync(planPath, JSON.stringify({ [ids.logistiek]: { reply: "ok" } }));
    const logiTurn = await turnIn(await ownTurn(LOGI, ids.logistiek, "What happened today?"));
    expect(logiTurn, log.slice(-3_000)).not.toBeNull();
    expect(context(logiTurn)).not.toContain(SECRET);
    // the admin's own conversation is not fed someone else's either
    const bossTurn = await turnIn(await ownTurn(BOSS, ids.logistiek, "What happened today?"));
    expect(bossTurn, log.slice(-3_000)).not.toBeNull();
    expect(context(bossTurn)).not.toContain(SECRET);
    const miguelTurn = await turnIn(await ownTurn(MIGUEL, ids.logistiek, "And my pallets?"));
    expect(miguelTurn, log.slice(-3_000)).not.toBeNull();
    expect(context(miguelTurn)).toContain(SECRET);
  }, 90_000);
});
