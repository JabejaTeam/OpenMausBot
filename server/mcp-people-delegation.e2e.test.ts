// Per-person MCP values on DELEGATED work. A signed-in admin (Boss) asks a
// Chief; the Chief hands the job to a teammate with coordinate_bots. The
// teammate's turn is done for Boss (its [Person] says so), so a people-only
// server (billit) holding only Boss's values must be mounted for it too.
// Regression: the teammate's [Person] named Boss while its MCP servers were
// resolved for nobody, so billit silently went missing.
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
const FAKE_MCP = join(SERVER_DIR, "testing", "fake-mcp-server.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const BOSS = "boss@example.test";

let child: ChildProcess;
let home: string;
let planPath: string;
let log = "";
let token = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}` },
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

posixOnly("per-person MCP values on delegated work", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-mcp-delegation-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    planPath = join(home, "room-plan.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      signIn: { admins: [BOSS], members: [] },
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_ROOM_PLAN: planPath }, config: { cli: FAKE_CLAUDE } } },
      mcpServers: {
        billit: { command: process.execPath, args: ["--experimental-strip-types", FAKE_MCP], env: { BILLIT_ENV: "production" },
          peopleOnly: true, people: { [BOSS]: { BILLIT_API_KEY: "boss-key" } } },
      },
    }));
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: () => ["admin", "client"] });
    token = registry.issue({ label: "boss's laptop", email: BOSS, scopes: ["admin", "client"] }).token;
    registry.close();
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
  }, 40_000);

  afterAll(async () => {
    child?.kill();
    if (child) await waitForExit(child);
    removeTempDir(home);
  });

  it("mounts the asker's people-only server for the teammate a Chief delegates to", async () => {
    const chief = (await api("POST", "/api/bots", { name: "Chief Owl" })).body.bot as { id: string; threadId: string };
    const books = (await api("POST", "/api/bots", { name: "Bookkeeper", section: "Books" })).body.bot as { id: string; threadId: string };
    const patched = await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Books"], acknowledgePeerScope: true });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    writeFileSync(planPath, JSON.stringify({
      [chief.id]: { steps: [{ arguments: { bot_ids: [books.id], request_key: "invoice", message: "Prepare the invoice" } }], reply: "Sent to Bookkeeper", resumeReply: "Invoice prepared" },
      [books.id]: { reply: "Invoice prepared" },
    }));

    const sent = await api("POST", `/api/bots/${chief.id}/messages`, { text: "Have the bookkeeper prepare the invoice", threadId: chief.threadId });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    const turn = await waitFor(() => evidence().find((entry) => entry.botId === books.id));
    expect(turn, log.slice(-3_000)).not.toBeNull();
    expect(JSON.stringify(turn.prompt)).toContain(BOSS);
    expect(turn.mcpServers).toContain("billit");
  }, 90_000);
});
