// Jabeja fork: every conversation is private on a workspace several people
// share (server/thread-access.ts), through the real server — with no setting
// at all, and a leftover OMB_PRIVATE_THREADS=0 cannot widen it. Boss is the
// admin, Ada and Bob are members, all on one bot. Ada's conversation is hers:
// Boss (admin) sees it, marked whose it is; Bob sees nothing of it until she
// shares it with him by name. Opening the bot lands everyone in their own
// latest conversation.
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
        HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1), OMB_PRIVATE_THREADS: "0",
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

  it("shows a conversation to its person and the admins, nobody else", async () => {
    const boss = await botAs(BOSS);
    expect(boss.threadId).toBe(ids.bossThread);
    expect(boss.tasks.map((task: any) => [task.threadId, task.access]).sort()).toEqual([[ids.adaThread, "team"], [ids.bossThread, "own"]].sort());
    expect(boss.tasks.find((task: any) => task.threadId === ids.adaThread).person).toBe(ids.adaKey);
    // the admin opens it on purpose, never by default
    expect(JSON.stringify(boss.messages)).not.toContain("ADA-PRIVATE-7");
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOSS)).status).toBe(200);
    const ada = await botAs(ADA);
    expect(ada.threadId).toBe(ids.adaThread);
    expect(ada.tasks.map((task: any) => task.threadId)).toEqual([ids.adaThread]);
    expect(ada.messages.some((m: any) => m.text?.includes("ADA-PRIVATE-7"))).toBe(true);
    // Bob: neither Ada's nor the boss's conversation
    const bob = await botAs(BOB);
    expect(bob.tasks).toEqual([]);
    expect(bob.messages).toEqual([]);
    for (const thread of [ids.adaThread, ids.bossThread]) {
      expect((await api("GET", `/api/threads/${thread}/messages`, undefined, BOB)).status).toBe(404);
      expect((await api("GET", `/api/threads/${thread}/export`, undefined, BOB)).status).toBe(404);
      expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "oops", threadId: thread }, BOB)).status).toBe(404);
      expect((await api("PATCH", `/api/bots/${ids.bot}/tasks/${thread}`, { title: "mine now" }, BOB)).status).toBe(404);
      expect((await api("POST", `/api/bots/${ids.bot}/interrupt`, { threadId: thread }, BOB)).status).toBe(404);
      expect((await api("GET", `/api/threads/${thread}/shares`, undefined, BOB)).status).toBe(404);
    }
    // No thread named: the bot's current one is not his, so nothing to fall back on.
    expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "oops" }, BOB)).status).toBe(409);
    expect(JSON.stringify((await api("GET", "/api/search?q=ADA-PRIVATE-7", undefined, BOB)).body)).not.toContain(ids.adaThread);
    expect(JSON.stringify((await api("GET", "/api/search?q=ADA-PRIVATE-7", undefined, BOSS)).body)).toContain(ids.adaThread);
  });

  it("lets an admin read along in someone's conversation, never write in it", async () => {
    const sent = await api("POST", `/api/bots/${ids.bot}/messages`, { text: "BOSS-WRITES-IN", threadId: ids.adaThread }, BOSS);
    expect(sent.status, JSON.stringify(sent.body)).toBe(403);
    const { status, body } = await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOSS);
    expect(status).toBe(200);
    expect(JSON.stringify(body)).not.toContain("BOSS-WRITES-IN");
    const adaLine = body.messages.find((m: any) => m.role === "user");
    const edit = await api("POST", `/api/bots/${ids.bot}/messages/${adaLine.id}/edit`, { text: "rewritten", threadId: ids.adaThread }, BOSS);
    expect(edit.status).toBe(403);
    // in a conversation of their own the admin writes as ever
    expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "BOSS-OWN", threadId: ids.bossThread }, BOSS)).status).toBe(202);
  });

  it("has no team-wide switch: private is the only setting", async () => {
    const refused = await api("PUT", `/api/threads/${ids.adaThread}/shares`, { private: false }, ADA);
    expect(refused.status).toBe(400);
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOB)).status).toBe(404);
    expect((await api("GET", `/api/threads/${ids.adaThread}/shares`, undefined, ADA)).body.private).toBe(true);
  });

  it("shares a conversation only with whom its person names, and takes it back", async () => {
    expect(ids.bobKey).toMatch(/^p_/);
    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: [ids.bobKey] }, BOSS)).status).toBe(403);
    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: ["p_notonthisworkspace00000"] }, ADA)).status).toBe(400);
    const shared = await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: [ids.bobKey] }, ADA);
    expect(shared.status, JSON.stringify(shared.body)).toBe(200);
    expect(shared.body.sharedWith.map((person: any) => person.email)).toEqual([BOB]);

    const bob = await botAs(BOB);
    expect(bob.tasks.map((task: any) => [task.threadId, task.access])).toEqual([[ids.adaThread, "shared"]]);
    expect(bob.threadId).toBe(ids.adaThread);
    expect(Array.isArray(bob.messages) && bob.messages.length > 0).toBe(true);
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOB)).status).toBe(200);
    expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "BOB-JOINS", threadId: ids.adaThread }, BOB)).status).toBe(202);
    // Bob is in it, but it stays Ada's to share; the boss's stays hidden from him.
    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: [] }, BOB)).status).toBe(403);
    expect((await api("GET", `/api/threads/${ids.bossThread}/messages`, undefined, BOB)).status).toBe(404);

    expect((await api("PUT", `/api/threads/${ids.adaThread}/shares`, { people: [] }, ADA)).status).toBe(200);
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOB)).status).toBe(404);
    expect((await botAs(BOB)).tasks.map((task: any) => task.threadId)).not.toContain(ids.adaThread);
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, BOSS)).status).toBe(200);
  });

  it("opens everyone on the conversation they last had open, not the one that changed last", async () => {
    // Ada starts a second conversation: that is where she is now
    const second = await api("POST", `/api/bots/${ids.bot}/tasks`, { title: "Ada's second" }, ADA);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    const secondThread = second.body.task.threadId;
    expect((await botAs(ADA)).threadId).toBe(secondThread);
    // a reply landing in her first conversation does not move her there
    expect((await api("POST", `/api/bots/${ids.bot}/messages`, { text: "later in the first", threadId: ids.adaThread }, ADA)).status).toBe(202);
    expect(await waitFor(async () => {
      const { body } = await api("GET", `/api/threads/${ids.adaThread}/messages`, undefined, ADA);
      return (body.messages ?? []).filter((m: any) => m.role === "bot" && m.text).length >= 2;
    }), log.slice(-2_000)).toBe(true);
    expect((await botAs(ADA)).threadId).toBe(secondThread);
    // opening the first (from any device) is remembered for all of hers
    expect((await api("PUT", "/api/people/me/navigation", { botId: ids.bot, threadId: ids.adaThread }, ADA)).status).toBe(200);
    expect((await botAs(ADA)).threadId).toBe(ids.adaThread);
    const visits = (await api("GET", "/api/people/me/navigation", undefined, ADA)).body.visits;
    expect(visits[ids.bot]).toMatchObject({ threadId: ids.adaThread });
    expect(typeof visits[ids.bot].at).toBe("number");
    // the boss's own place is untouched by hers, and nobody records a conversation that isn't there
    expect((await botAs(BOSS)).threadId).toBe(ids.bossThread);
    expect((await api("PUT", "/api/people/me/navigation", { botId: ids.bot, threadId: "no-such-thread" }, BOB)).status).toBe(404);
  });

  it("announces a member's new conversation as theirs, from the very first live frame", async () => {
    // The live stream once announced the thread before its person was known:
    // the member got it as the admin's (hidden), back on their old thread,
    // and that frame could land after the HTTP answer and undo the switch.
    const controller = new AbortController();
    const frames: any[] = [];
    let hello = false;
    void (async () => {
      try {
        const res = await fetch(`${BASE}/api/events`, { headers: { authorization: `Bearer ${tokens[ADA]}` }, signal: controller.signal });
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            for (const line of buffer.slice(0, end).split("\n")) {
              if (!line.startsWith("data: ")) continue;
              const frame = JSON.parse(line.slice(6));
              if (frame.kind === "hello") hello = true;
              else frames.push(frame);
            }
            buffer = buffer.slice(end + 2);
          }
        }
      } catch { /* aborted */ }
    })();
    try {
      expect(await waitFor(async () => hello, 10_000)).toBe(true);
      const created = await api("POST", `/api/bots/${ids.bot}/tasks`, {}, ADA);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const fresh = created.body.task.threadId;
      const first = await waitFor(async () => frames.find((frame) => frame.kind === "bot" && frame.bot?.id === ids.bot), 10_000);
      expect(first?.bot.threadId).toBe(fresh);
      expect(first?.bot.tasks.find((task: any) => task.threadId === fresh)?.access).toBe("own");
    } finally {
      controller.abort();
    }
  });

  it("keeps everything open to the owner on this machine", async () => {
    expect((await api("GET", `/api/threads/${ids.adaThread}/messages`)).status).toBe(200);
  });
});
