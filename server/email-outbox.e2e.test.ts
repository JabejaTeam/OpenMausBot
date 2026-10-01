// Outgoing Gmail (fork) through the real server and a stub connected-apps
// service:
//   - a person in the chat gets an editable email card instead of the send,
//     and their choice goes out with their Gmail signature;
//   - a routine's run (unattended) may only draft, signed; a routine whose
//     mail setting is "send" sends, signed.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPABILITY_KEY = "email-outbox-capability";
const SIGNATURE = '<div dir="ltr"><b>Ada Lindqvist</b><br>Hollow Pine Studio</div>';
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess;
let stub: Server;
let home: string;
let gate: string;
let log = "";
/** Every connected-app tool the stub ran: [slug, arguments]. */
const executed: Array<[string, Record<string, any>]> = [];

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
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

function toolData(slug: string): Record<string, unknown> {
  if (slug === "GMAIL_GET_PROFILE") return { emailAddress: "ada@hollowpine.test" };
  if (slug === "GMAIL_SETTINGS_SEND_AS_GET") return { sendAsEmail: "ada@hollowpine.test", signature: SIGNATURE };
  if (slug === "GMAIL_CREATE_EMAIL_DRAFT") return { id: "r-draft-41", message: { id: "m-draft-41" } };
  return { id: "m-sent-17" };
}

function startStub(): Promise<number> {
  stub = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const frame = raw ? JSON.parse(raw) : {};
    if (frame.id === undefined) {
      res.writeHead(202).end();
      return;
    }
    const reply = (result: unknown) => {
      res.writeHead(200, { "content-type": "application/json", "mcp-session-id": "stub-session" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: frame.id, result }));
    };
    if (frame.method === "initialize") return reply({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "stub", version: "1" } });
    if (frame.method !== "tools/call") return reply({ tools: [] });
    const name = frame.params.name as string;
    const tools: Array<{ tool_slug: string; arguments: Record<string, any> }> = name === "COMPOSIO_MULTI_EXECUTE_TOOL"
      ? frame.params.arguments.tools
      : [{ tool_slug: name, arguments: frame.params.arguments }];
    for (const tool of tools) executed.push([tool.tool_slug, tool.arguments]);
    const results = tools.map((tool, index) => ({ response: { successful: true, data: toolData(tool.tool_slug) }, tool_slug: tool.tool_slug, index }));
    reply({ content: [{ type: "text", text: JSON.stringify({ data: { results }, error: null, successful: true }) }] });
  });
  return new Promise((resolve) => stub.listen(0, "127.0.0.1", () => resolve((stub.address() as { port: number }).port)));
}

async function relayCall(botId: string, threadId: string, params: Record<string, unknown>): Promise<string> {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId, threadId, kind: "connectors", skillAuthoring: false }),
  });
  expect(minted.status).toBe(201);
  const { token } = await minted.json() as { token: string };
  const response = await fetch(`${BASE}/api/internal/connectors/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params }),
  });
  const body = await response.json() as { result?: { content?: Array<{ text: string }> }; error?: { message: string } };
  return body.error?.message ?? (body.result?.content ?? []).map((item) => item.text).join("\n");
}

const sent = (slug: string) => executed.filter(([tool]) => tool === slug).map(([, args]) => args);
const messages = async (threadId: string) =>
  ((await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? []) as any[];

async function newBot(name: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", { name });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.bot;
}

async function liveRoutineRun(bot: { id: string }, mail?: "send"): Promise<string> {
  const made = await api("POST", "/api/routines", {
    name: `Weekly update ${mail ?? "draft"}`, botId: bot.id, prompt: "Mail the weekly update.", enabled: false,
    schedule: { type: "daily", time: "09:00" }, ...(mail ? { mail } : {}),
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  expect(made.body.routine.mail).toBe(mail);
  expect((await api("POST", `/api/routines/${made.body.routine.id}/run`, {})).status).toBeLessThan(300);
  const run = await waitFor(async () => {
    const runs = (await api("GET", "/api/routines")).body.runs as any[] ?? [];
    return runs.find((r) => r.routineId === made.body.routine.id && r.threadId && r.status === "running");
  });
  expect(run, log.slice(-3_000)).toBeTruthy();
  return run.threadId;
}

posixOnly("outgoing Gmail: cards, drafts and the person's signature", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-email-outbox-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    gate = join(home, "finish-gate");
    writeFileSync(gate, "");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate }, config: { cli: FAKE_CLAUDE } } },
    }));
    const stubPort = await startStub();
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
        OMB_COMPOSIO_BROKER_URL: `http://127.0.0.1:${stubPort}`,
        OMB_COMPOSIO_BROKER_TOKEN: "a".repeat(64),
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
  }, 40_000);

  afterAll(async () => {
    child?.kill();
    if (child) await waitForExit(child);
    stub?.close();
    removeTempDir(home);
  });

  it("shows a person an email card and sends their edited version, signed", async () => {
    const bot = await newBot("Paper Kestrel");
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Mail Bowie the update", threadId: bot.threadId })).status).toBe(202);
    expect(await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.text)), log.slice(-3_000)).toBeTruthy();

    const answer = await relayCall(bot.id, bot.threadId, {
      name: "GMAIL_SEND_EMAIL",
      arguments: { recipient_email: "bowie@boa.test", subject: "Update", body: "Dag Bowie" },
    });
    expect(answer).toContain("editable email card");
    expect(sent("GMAIL_SEND_EMAIL")).toEqual([]);

    const card = (await messages(bot.threadId)).find((m) => m.kind === "email");
    expect(card?.email).toMatchObject({ to: ["bowie@boa.test"], subject: "Update", body: "Dag Bowie", requested: "send", status: "editable", signature: SIGNATURE });

    const path = `/api/bots/${bot.id}/email-cards/${card.id}`;
    expect((await api("POST", `${path}/send`, { threadId: bot.threadId, to: "", body: "x" })).status).toBe(400);
    const done = await api("POST", `${path}/send`, {
      threadId: bot.threadId, to: ["bowie@boa.test"], cc: ["miguel@ripal.test"], bcc: ["archief@hollowpine.test"], subject: "Update week 40", body: "Dag Bowie,\nAangepast door Ada.",
    });
    expect(done, JSON.stringify(done.body)).toMatchObject({ status: 200, body: { status: "sent" } });
    const [mail] = sent("GMAIL_SEND_EMAIL");
    expect(mail).toMatchObject({ recipient_email: "bowie@boa.test", cc: ["miguel@ripal.test"], bcc: ["archief@hollowpine.test"], subject: "Update week 40", is_html: true });
    expect(mail!.body).toContain("Aangepast door Ada.");
    expect(mail!.body).toContain(SIGNATURE);
    expect((await api("POST", `${path}/send`, { threadId: bot.threadId })).status).toBe(409);

    const after = (await messages(bot.threadId)).find((m) => m.id === card.id);
    expect(after.email).toMatchObject({ status: "sent", messageId: "m-sent-17", subject: "Update week 40" });
    // The bot hears what the person chose.
    expect(await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.text?.includes("the person SENT the email"))), log.slice(-3_000)).toBeTruthy();
  }, 90_000);

  it("saves a card as a draft or drops it", async () => {
    const bot = await newBot("Linen Heron");
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Draft two mails", threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.text));
    await relayCall(bot.id, bot.threadId, {
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [
        { tool_slug: "GMAIL_CREATE_EMAIL_DRAFT", arguments: { recipient_email: "a@boa.test", subject: "Een", body: "1" } },
        { tool_slug: "GMAIL_CREATE_EMAIL_DRAFT", arguments: { recipient_email: "b@boa.test", subject: "Twee", body: "2" } },
      ] },
    });
    const cards = (await messages(bot.threadId)).filter((m) => m.kind === "email");
    expect(cards.map((m) => m.email.requested)).toEqual(["draft", "draft"]);
    const before = sent("GMAIL_CREATE_EMAIL_DRAFT").length;
    expect((await api("POST", `/api/bots/${bot.id}/email-cards/${cards[0].id}/draft`, { threadId: bot.threadId })).body).toEqual({ status: "drafted" });
    expect(sent("GMAIL_CREATE_EMAIL_DRAFT").slice(before)[0]!.body).toContain(SIGNATURE);
    expect((await api("POST", `/api/bots/${bot.id}/email-cards/${cards[1].id}/discard`, { threadId: bot.threadId })).body).toEqual({ status: "discarded" });
    expect(sent("GMAIL_CREATE_EMAIL_DRAFT").length).toBe(before + 1);

    const mixed = await relayCall(bot.id, bot.threadId, {
      name: "COMPOSIO_MULTI_EXECUTE_TOOL",
      arguments: { tools: [{ tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} }, { tool_slug: "GMAIL_SEND_EMAIL", arguments: { recipient_email: "a@boa.test", body: "x" } }] },
    });
    expect(mixed).toContain("must run in their own call");
  }, 90_000);

  it("lets a routine only draft, unless its mail setting says send", async () => {
    rmSync(gate);
    try {
      const drafter = await newBot("Quiet Lark");
      const draftThread = await liveRoutineRun(drafter);
      const drafted = await relayCall(drafter.id, draftThread, {
        name: "GMAIL_SEND_EMAIL",
        arguments: { recipient_email: "bowie@boa.test", subject: "Weekly", body: "Dag allemaal" },
      });
      expect(drafted).toContain("NOT sent");
      const draft = sent("GMAIL_CREATE_EMAIL_DRAFT").at(-1)!;
      expect(draft).toMatchObject({ recipient_email: "bowie@boa.test", subject: "Weekly", is_html: true });
      expect(draft.body).toContain(SIGNATURE);
      expect(sent("GMAIL_SEND_EMAIL").some((args) => args.subject === "Weekly")).toBe(false);
      expect(await relayCall(drafter.id, draftThread, { name: "GMAIL_SEND_DRAFT", arguments: { draft_id: "r1" } })).toContain("allows Gmail drafts only");
      expect(sent("GMAIL_SEND_DRAFT")).toEqual([]);

      const sender = await newBot("Swift Tern");
      const sendThread = await liveRoutineRun(sender, "send");
      await relayCall(sender.id, sendThread, {
        name: "GMAIL_SEND_EMAIL",
        arguments: { recipient_email: "team@boa.test", subject: "Direct", body: "Gaat meteen weg" },
      });
      const direct = sent("GMAIL_SEND_EMAIL").find((args) => args.subject === "Direct");
      expect(direct?.body).toContain(SIGNATURE);
    } finally {
      writeFileSync(gate, "");
    }
  }, 90_000);
});
