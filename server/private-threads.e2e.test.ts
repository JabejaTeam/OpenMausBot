// Jabeja fork: conversations per person on a workspace several people share
// (server/thread-access.ts), through the real server with
// OMB_PRIVATE_THREADS=1. Boss is the admin, Ada and Bob are members, all on
// one bot. Ada's conversation is in her channel: the team sees it and writes
// in it, each thread marked with whose it is, until she marks it private —
// then Boss (admin) and Bob see nothing of it until she shares it with Bob.
// Opening the bot lands everyone in their own latest conversation.
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
const BOB = "bob@example.test";

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

const ids = { bot: "", bossThread: "", adaThread: "", bobKey: "", adaKey: "" };
const botAs = async (as: string) => (await api("GET", "/api/bots?messages=20", undefined, as)).body.bots.find((bot: any) => bot.id === ids.bot);

posixOnly("private conversations on a shared workspace", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-private-threads-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: { grok: { driver: "grokAgent", config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    const role = (email: string) => (email === BOSS ? ["admin", "client"] as const : ["client"] as const);
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: (email) => [...role(email)] });
    for (const email of [BOSS, ADA, BOB]) tokens[email] = registry.issue({ label: `${email.split("@")[0]}'s laptop`, email, scopes: [...role(email)] }).token;
    registry.close();
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1), OMB_PRIVATE_THREADS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    expect(await waitFor(async () => (await fetch(`${BASE}/api/health`).catch(() => null))?.ok, 20_000), log).toBe(true);

    const created = await api("POST", "/api/bots", { name: "Helpdesk Otter" }, BOSS);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    ids.bot = created.body.bot.id;
    ids.bossThread = created.body.bot.threadId;
    expect((await api("PATCH", `/api/bots/${ids.bot}`, { modelSelection: { instanceId: "grok", model: "fake-model" } }, BOSS)).status).toBe(200);
    // Ada opens her own conversation: the bot's current thread is now hers.
    const task = await api("POST", `/api/bots/${ids.bot}/tasks`, { title: "Ada's question" }, ADA);
    expect(task.status, JSON.stringify(task.body)).toBe(201);
    ids.adaThread = task.body.task.threadId;
    expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "ADA-PRIVATE-7 my salary", threadId: ids.adaThread }, ADA)).status).toBe(202);
    expect(await waitFor(async () => {
      const { body } = await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, ADA);
      return (body.messages ?? []).some((m: any) => m.role === "bot" && m.text);
    }), log.slice(-2_000)).toBe(true);
    const shares = await api("GET", `/api/threads/${ids.adaThread}/shares`, undefined, ADA);
    expect(shares.status).toBe(200);
    ids.bobKey = shares.body.candidates.find((person: any) => person.email === BOB)?.key ?? "";
    ids.adaKey = shares.body.owner?.key ?? "";
  }, 90_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("tells the client conversations are private", async () => {
    expect((await api("GET", "/api/auth/session", undefined, ADA)).body.privateThreads).toBe(true);
  });

  it("shows the team every conversation, with whose it is, but opens everyone in their own", async () => {
    const boss = await botAs(BOSS);
    expect(boss.threadId).toBe(ids.bossThread);
    expect(boss.tasks.map((task: any) => [task.threadId, task.access]).sort()).toEqual([[ids.adaThread, "team"], [ids.bossThread, "own"]].sort());
    expect(boss.tasks.find((task: any) => task.threadId === ids.adaThread).person).toBe(ids.adaKey);
    expect(JSON.stringify(boss.messages)).not.toContain("ADA-PRIVATE-7");
    // Every snapshot carries the open thread's transcript, also when that
    // is already the bot's current thread (the client cannot render without).
    expect(Array.isArray(boss.messages)).toBe(true);
    const ada = await botAs(ADA);
    expect(ada.threadId).toBe(ids.adaThread);
    expect(ada.messages.some((m: any) => m.text?.includes("ADA-PRIVATE-7"))).toBe(true);
    // Bob has no conversation of his own: he sees the team's, opens none.
    const bob = await botAs(BOB);
    expect(bob.tasks.map((task: any) => task.access)).toEqual(["team", "team"]);
    expect(bob.messages).toEqual([]);
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOB)).status).toBe(200);
    expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "BOB-HELPS", threadId: ids.adaThread }, BOB)).status).toBe(202);
  });

  it("hides a conversation its person marks private, admins included", async () => {
    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { private: true }, BOB)).status).toBe(403);
    const marked = await api("PUT", `/api/threads/${ids.adaThread}/shares`, { private: true }, ADA);
    expect(marked.status, JSON.stringify(marked.body)).toBe(200);
    expect(marked.body.private).toBe(true);
    for (const as of [BOSS, BOB]) {
      expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, as)).status).toBe(404);
      expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "oops", threadId: ids.adaThread }, as)).status).toBe(404);
      expect((await api("PATCH", `/api/bots/${ids.bot}/tasks/${ids.adaThread}`, { title: "mine now" }, as)).status).toBe(404);
      expect((await api("POST", `/api/bots/${ids.bot}/interrupt`, { threadId: ids.adaThread }, as)).status).toBe(404);
      expect((await api("GET", `/api/threads/${ids.adaThread}/shares`, undefined, as)).status).toBe(404);
      expect((await botAs(as)).tasks.map((task: any) => task.threadId)).not.toContain(ids.adaThread);
    }
    // No thread named: the bot's current one is Ada's, so nothing to fall back on.
    expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "oops" }, BOB)).status).toBe(409);
    const search = await api("GET", "/api/search?q=ADA-PRIVATE-7", undefined, BOSS);
    expect(JSON.stringify(search.body)).not.toContain(ids.adaThread);
  });

  it("shares a conversation only when its person says so, and takes it back", async () => {
    expect(ids.bobKey).toMatch(/^p_/);
    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: ["p_notonthisworkspace00000"] }, ADA)).status).toBe(400);
    const shared = await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: [ids.bobKey] }, ADA);
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
    expect(shared.body.sharedWith.map((person: any) => person.email)).toEqual([BOB]);

    const bob = await botAs(BOB);
    expect(bob.tasks.find((task: any) => task.threadId === ids.adaThread)?.access).toBe("shared");
    expect(bob.threadId).toBe(ids.adaThread);
    expect(Array.isArray(bob.messages) && bob.messages.length > 0).toBe(true);
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOB)).status).toBe(200);
    expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "BOB-JOINS", threadId: ids.adaThread }, BOB)).status).toBe(202);
    // Shared, not the team's: still private.
    // Bob is in it, but it stays Ada's to share.
    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: [] }, BOB)).status).toBe(403);
    // Still nothing for the admin.
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOSS)).status).toBe(404);

    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: [] }, ADA)).status).toBe(200);
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOB)).status).toBe(404);
    expect((await botAs(BOB)).tasks.map((task: any) => task.threadId)).not.toContain(ids.adaThread);

    // Back to the team.
    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { private: false }, ADA)).status).toBe(200);
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOSS)).status).toBe(200);
  });

  it("keeps everything open to the owner on this machine", async () => {
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`)).status).toBe(200);
  });
});
