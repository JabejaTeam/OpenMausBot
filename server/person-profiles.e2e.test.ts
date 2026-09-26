// A profile per person through the real server and the fake Claude CLI, which
// dumps the prompt it was given. One bot, one thread, two members taking turns:
//
//   - each person reads and edits only their own profile (Settings → About me);
//   - each turn names the person it is for and carries their profile, never
//     the other person's.
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
const PORT = 38800 + Math.floor(Math.random() * 10_000);
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

posixOnly("a profile per person, carried by the turns done for them", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-person-profiles-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    dumpPath = join(home, "fake-claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [ADA, BOB] },
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dumpPath }, config: { cli: FAKE_CLAUDE } } },
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

  it("lets each person keep only their own profile", async () => {
    expect((await api("GET", "/api/people/me", undefined, ADA)).body).toMatchObject({ email: ADA, name: "", text: "" });
    const saved = await api("PUT", "/api/people/me", { name: "Ada", text: "- Prefers short answers" }, ADA);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await api("PUT", "/api/people/me", { text: "- Writes in French" }, BOB)).status).toBe(200);
    const bobs = await api("GET", "/api/people/me", undefined, BOB);
    expect(bobs.body).toMatchObject({ email: BOB, text: "- Writes in French" });
    expect(JSON.stringify(bobs.body)).not.toContain("short answers");
    expect((await api("PUT", "/api/people/me", { name: "two\nlines" }, ADA)).status).toBe(400);
  });

  it("names the person a turn is for and carries only their profile", async () => {
    const created = await api("POST", "/api/bots", { name: "Shared Wren" }, BOSS);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };

    const ada = await turnAs(ADA, bot, "Ada asks for a summary");
    expect(ada).toContain(`working for Ada (${ADA})`);
    expect(ada).toContain("Prefers short answers");
    expect(ada).not.toContain("Writes in French");

    const bob = await turnAs(BOB, bot, "Bob asks the same bot");
    expect(bob).toContain(`working for ${BOB}`);
    expect(bob).toContain("Writes in French");
    expect(bob).not.toContain("short answers");
  }, 90_000);
});
