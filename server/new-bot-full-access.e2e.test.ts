// A workspace default of Full access for new bots, on a server several people
// share, through the real server and a fake engine that asks permission for
// every tool. An admin (Boss) and a member (Ada) sign in with email sessions
// issued before boot; config.json sets newBots.approvalMode = "full".
//
//   - a bot a person creates starts on Full, and so do its new threads;
//   - a member's request to it runs without a card (the harness answers the
//     engine's residual permission prompt, exactly as for the owner);
//   - control: the same engine on an Ask bot stops at a card for the member;
//   - the default is read-only over HTTP, and an admin-only bot stays hidden
//     from the member.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";
const ADA = "ada@example.test";
const GROK = { instanceId: "grok", model: "fake-model" };

let child: ChildProcess;
let home: string;
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

async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 30_000): Promise<T | null> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const messages = async (threadId: string) =>
  ((await api("GET", `/api/threads/${threadId}/messages?limit=100`, undefined, BOSS)).body.messages ?? []) as any[];
const openCards = (list: any[]) => list.filter((m) => m.card && !m.card.answered && !m.card.dismissed);
const replied = (threadId: string, text: string) => waitFor(async () => {
  const list = await messages(threadId);
  const asked = list.findIndex((m) => m.role === "user" && m.text?.includes(text));
  return asked >= 0 && list.slice(asked + 1).some((m) => m.role === "bot" && m.text?.includes("handled the permission decision")) ? list : null;
});

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

async function makeBot(name: string) {
  const created = await api("POST", "/api/bots", { name, modelSelection: GROK }, BOSS);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.bot as { id: string; threadId: string; approvalMode?: string };
}

posixOnly("a Full access default for new bots on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-new-bot-full-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA] },
      newBots: { approvalMode: "full" },
      instances: {
        grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission" }, config: { cli: FAKE_CLI, fullAuto: false } },
      },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] }).token;
    registry.close();
    await start();
  }, 40_000);

  afterAll(async () => {
    child?.kill();
    if (child) await waitForExit(child);
    removeTempDir(home);
  });

  it("starts a person's new bot and its new threads on Full, and runs a member's request without a card", async () => {
    expect((await api("GET", "/api/config", undefined, BOSS)).body.newBots).toMatchObject({ approvalMode: "full" });
    const bot = await makeBot("Ops Otter");
    expect(bot.approvalMode).toBe("full");

    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "Ada asks for a deploy", threadId: bot.threadId }, ADA);
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    const done = await replied(bot.threadId, "Ada asks for a deploy");
    expect(done, log.slice(-3_000)).not.toBeNull();
    expect(openCards(done!)).toHaveLength(0);

    const task = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Ada's thread" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    const threadId = task.body.task.threadId as string;
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Ada in her own thread", threadId }, ADA)).status).toBe(202);
    const inThread = await replied(threadId, "Ada in her own thread");
    expect(inThread, log.slice(-3_000)).not.toBeNull();
    expect(openCards(inThread!)).toHaveLength(0);
  }, 60_000);

  it("still stops at a card for the member on an Ask bot (control)", async () => {
    const bot = await makeBot("Careful Crane");
    expect((await api("PATCH", `/api/bots/${bot.id}`, { approvalMode: "ask" }, BOSS)).status).toBe(200);
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Ada asks carefully", threadId: bot.threadId }, ADA)).status).toBe(202);
    const card = await waitFor(async () => {
      const list = await messages(bot.threadId);
      return openCards(list).length ? list : null;
    });
    expect(card, log.slice(-3_000)).not.toBeNull();
    expect(card!.some((m) => m.role === "bot" && m.text?.includes("handled the permission decision"))).toBe(false);
  }, 60_000);

  it("keeps the default read-only over HTTP and an admin-only bot hidden from the member", async () => {
    expect((await api("PATCH", "/api/config", { newBots: { approvalMode: "ask" } }, BOSS)).status).toBe(400);
    expect((await api("PATCH", "/api/config", { newBots: { effort: "medium" } }, ADA)).status).toBe(403);

    const books = await makeBot("Books Heron");
    expect((await api("PATCH", `/api/bots/${books.id}`, { visibility: "admins" }, BOSS)).status).toBe(200);
    const seenByAda = ((await api("GET", "/api/bots", undefined, ADA)).body.bots as any[]).map((b) => b.name);
    expect(seenByAda).not.toContain("Books Heron");
    expect(seenByAda).toContain("Ops Otter");
    expect((await api("GET", `/api/threads/${books.threadId}/messages`, undefined, ADA)).status).toBe(404);
    expect((await api("POST", `/api/bots/${books.id}/messages`, { text: "peek", threadId: books.threadId }, ADA)).status).toBe(404);
    expect(((await api("GET", "/api/bots", undefined, BOSS)).body.bots as any[]).map((b) => b.name)).toContain("Books Heron");
  }, 30_000);
});
