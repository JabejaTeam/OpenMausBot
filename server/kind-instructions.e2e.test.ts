// Workspace rules by kind of bot through the real server and the fake Claude
// CLI, which dumps the system prompt it was spawned with: a code agent gets
// the shared and the code rules, a plain bot only the shared ones, and an
// edited text reaches the next turn without touching any bot.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess;
let home: string;
let dumpPath: string;
let log = "";

const api = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${BASE}${path}`, {
    method, headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as any };
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

/** Send one message and return the system prompt the engine was spawned with. */
async function promptFor(bot: { id: string; threadId: string }, text: string): Promise<string> {
  rmSync(dumpPath, { force: true });
  expect((await api("POST", `/api/bots/${bot.id}/messages`, { text, threadId: bot.threadId })).status).toBe(202);
  const dump = await waitFor(() => {
    if (!existsSync(dumpPath)) return null;
    try { return JSON.parse(readFileSync(dumpPath, "utf8")) as { systemPrompt: string | null }; } catch { return null; }
  });
  expect(dump, log.slice(-3_000)).not.toBeNull();
  await waitFor(async () => {
    const list = (await api("GET", `/api/threads/${bot.threadId}/messages?limit=50`)).body.messages as any[] ?? [];
    const asked = list.findIndex((m) => m.role === "user" && m.text?.includes(text));
    return asked >= 0 && list.slice(asked + 1).some((m) => m.role === "bot" && m.text);
  });
  return dump!.systemPrompt ?? "";
}

posixOnly("workspace rules by kind of bot", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-kind-rules-"));
    mkdirSync(join(home, ".openmausbot"), { recursive: true });
    dumpPath = join(home, "fake-claude-dump.json");
    writeFileSync(join(home, ".openmausbot", "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dumpPath }, config: { cli: FAKE_CLAUDE } } },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const up = await waitFor(async () => { try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; } }, 20_000);
    if (!up) throw new Error(`server never came up:\n${log}`);
  }, 40_000);

  afterAll(async () => {
    child?.kill();
    if (child) await waitForExit(child);
    removeTempDir(home);
  });

  it("gives code agents their rules at every turn, and plain bots only the shared ones", async () => {
    expect((await api("PUT", "/api/kind-instructions/everyone", { text: "EVERYONE-RULE: expect only the edit." })).status).toBe(200);
    expect((await api("PUT", "/api/kind-instructions/code", { text: "CODE-RULE-V1: surgical changes." })).status).toBe(200);
    expect((await api("PUT", "/api/kind-instructions/boss", { text: "x" })).status).toBe(404);

    const coder = (await api("POST", "/api/bots", { name: "Coder", settings: { kind: "code", soul: "Always run the full CI." } })).body.bot;
    expect(coder.kind).toBe("code");
    const planner = (await api("POST", "/api/bots", { name: "Planner" })).body.bot;
    const switched = (await api("POST", "/api/bots", { name: "Later Coder" })).body.bot;
    expect((await api("PATCH", `/api/bots/${switched.id}`, { kind: "code" })).body.bot.kind).toBe("code");

    const coderPrompt = await promptFor(coder, "Coder, change the header");
    expect(coderPrompt).toContain("EVERYONE-RULE");
    expect(coderPrompt).toContain("CODE-RULE-V1");
    expect(coderPrompt.indexOf("CODE-RULE-V1")).toBeGreaterThan(coderPrompt.indexOf("Always run the full CI."));

    const plannerPrompt = await promptFor(planner, "Planner, plan the sprint");
    expect(plannerPrompt).toContain("EVERYONE-RULE");
    expect(plannerPrompt).not.toContain("CODE-RULE");

    expect(await promptFor(switched, "Later coder, fix the footer")).toContain("CODE-RULE-V1");

    expect((await api("PUT", "/api/kind-instructions/code", { text: "CODE-RULE-V2: even simpler." })).status).toBe(200);
    const next = await promptFor(coder, "Coder, next change");
    expect(next).toContain("CODE-RULE-V2");
    expect(next).not.toContain("CODE-RULE-V1");

    expect((await api("PATCH", `/api/bots/${switched.id}`, { kind: null })).body.bot.kind).toBeUndefined();
    expect(await promptFor(switched, "Back to plain")).not.toContain("CODE-RULE");
  }, 120_000);
});
