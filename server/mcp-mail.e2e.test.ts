// Mail through a custom MCP server (fork, server/mcp-mail.ts), through the
// real server: what the mail gate asks /api/internal/mcp-mail, and what the
// person's email card answers it.
//   - a person in the chat gets the email card; Send returns the call with
//     their edits, Discard a refusal; never a draft or "always";
//   - a routine whose mail setting is "send" passes without a card, also
//     only to the addresses its server allows unattended;
//   - a call that sends nothing passes untouched.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const PORT = 38800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const CAPABILITY_KEY = "mcp-mail-capability";
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess;
let home: string;
let log = "";

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
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

async function bearer(botId: string, threadId: string): Promise<string> {
  const minted = await api("POST", "/api/testing/internal-capability", { botId, threadId, kind: "mail" }, { "x-openmausbot-test-capability": CAPABILITY_KEY });
  expect(minted.status, JSON.stringify(minted.body)).toBe(201);
  return minted.body.token;
}

/** What the mail gate does for one tools/call: ask, and wait for the answer. */
const ask = (token: string, server: string, tool: string, args: Record<string, unknown>) =>
  api("POST", "/api/internal/mcp-mail", { server, tool, arguments: args }, { authorization: `Bearer ${token}` });

const messages = async (threadId: string) =>
  ((await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? []) as any[];

async function newBot(name: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", { name });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.bot;
}

async function talking(name: string): Promise<{ id: string; threadId: string }> {
  const bot = await newBot(name);
  expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Mail Jan the offer", threadId: bot.threadId })).status).toBe(202);
  expect(await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.text)), log.slice(-3_000)).toBeTruthy();
  return bot;
}

async function routineRun(bot: { id: string }, mail: "send"): Promise<string> {
  const made = await api("POST", "/api/routines", {
    name: "Daily orders", botId: bot.id, prompt: "Mail the orders.", enabled: false,
    schedule: { type: "daily", time: "09:00" }, mail,
  });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  expect((await api("POST", `/api/routines/${made.body.routine.id}/run`, {})).status).toBeLessThan(300);
  const run = await waitFor(async () => {
    const runs = (await api("GET", "/api/routines")).body.runs as any[] ?? [];
    return runs.find((r) => r.routineId === made.body.routine.id && r.threadId);
  });
  expect(run, log.slice(-3_000)).toBeTruthy();
  return run.threadId;
}

const sendMail = {
  body: {
    Message: {
      subject: "Offerte 4711",
      body: { contentType: "Text", content: "Dag Jan" },
      toRecipients: [{ emailAddress: { address: "jan@klant.test" } }],
    },
    SaveToSentItems: true,
  },
};

posixOnly("mail through a custom MCP server: the email card", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-mcp-mail-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "happy" }, config: { cli: FAKE_CLAUDE } } },
      mcpServers: {
        outlook: { command: process.execPath, args: ["-e", ""], outbound: "ms365" },
        odoo: { command: process.execPath, args: ["-e", ""], outbound: { preset: "odoo", unattendedTo: ["@ripal.test"] } },
      },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
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
    removeTempDir(home);
  });

  it("holds a send on the email card and returns the person's edited version", async () => {
    const bot = await talking("Copper Wren");
    const token = await bearer(bot.id, bot.threadId);
    const held = ask(token, "outlook", "send-mail", sendMail);
    const card = await waitFor(async () => (await messages(bot.threadId)).find((m) => m.kind === "email"));
    expect(card?.email).toMatchObject({
      to: ["jan@klant.test"], subject: "Offerte 4711", body: "Dag Jan", requested: "send", status: "editable",
      mcp: { server: "outlook", tool: "send-mail", editable: true },
    });
    const path = `/api/bots/${bot.id}/email-cards/${card.id}`;
    // Send or discard only: no draft, and nothing that answers future mail.
    expect((await api("POST", `${path}/draft`, { threadId: bot.threadId })).status).toBe(400);
    expect((await api("POST", `${path}/always`, { threadId: bot.threadId })).status).toBe(404);
    expect((await api("POST", `${path}/send`, { threadId: bot.threadId, to: "", body: "x" })).status).toBe(400);
    const chose = await api("POST", `${path}/send`, { threadId: bot.threadId, to: ["jan@klant.test"], cc: ["inkoop@klant.test"], subject: "Offerte 4711 (herzien)", body: "Dag Jan,\nmet korting." });
    expect(chose, JSON.stringify(chose.body)).toMatchObject({ status: 200, body: { status: "working" } });

    const answer = await held;
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ action: "send", cardId: card.id });
    expect(answer.body.arguments).toEqual({
      body: {
        Message: {
          subject: "Offerte 4711 (herzien)",
          body: { contentType: "Text", content: "Dag Jan,\nmet korting." },
          toRecipients: [{ emailAddress: { address: "jan@klant.test" } }],
          ccRecipients: [{ emailAddress: { address: "inkoop@klant.test" } }],
        },
        SaveToSentItems: true,
      },
    });
    expect(answer.body.note).toContain("with their own changes");

    expect((await api("POST", "/api/internal/mcp-mail/done", { cardId: card.id, ok: true }, { authorization: `Bearer ${token}` })).body).toEqual({ status: "sent" });
    expect((await messages(bot.threadId)).find((m) => m.id === card.id)?.email.status).toBe("sent");
    expect((await api("POST", `${path}/send`, { threadId: bot.threadId })).status).toBe(409);
  }, 90_000);

  it("answers a discarded card with a refusal", async () => {
    const bot = await talking("Slate Finch");
    const token = await bearer(bot.id, bot.threadId);
    const held = ask(token, "odoo", "odoo_send_message", { instance: "prod", model: "res.partner", record_id: 42, body: "Hallo", partner_ids: [42], dry_run: false, confirmation_token: "t" });
    const card = await waitFor(async () => (await messages(bot.threadId)).find((m) => m.kind === "email"));
    expect(card?.email.mcp).toMatchObject({ server: "odoo", editable: false });
    expect(card?.email.to).toEqual(["#42"]);
    expect((await api("POST", `/api/bots/${bot.id}/email-cards/${card.id}/discard`, { threadId: bot.threadId })).body).toEqual({ status: "discarded" });
    const answer = await held;
    expect(answer.body).toMatchObject({ action: "refuse" });
    expect(answer.body.text).toContain("discarded");
  }, 90_000);

  it("lets what sends nothing pass, and a routine allowed to send go without a card", async () => {
    const bot = await talking("Amber Shrike");
    const token = await bearer(bot.id, bot.threadId);
    expect((await ask(token, "outlook", "list-mail-messages", { top: 3 })).body).toEqual({ action: "send", arguments: { top: 3 } });
    expect((await ask(token, "odoo", "odoo_send_message", { record_id: 42, body: "x", partner_ids: [42] })).body.action).toBe("send");
    expect((await messages(bot.threadId)).some((m) => m.kind === "email")).toBe(false);

    const runner = await newBot("Night Owl");
    const thread = await routineRun(runner, "send");
    const routineToken = await bearer(runner.id, thread);
    expect((await ask(routineToken, "outlook", "send-mail", sendMail)).body).toEqual({ action: "send", arguments: sendMail });
    // odoo allows unattended mail only to @ripal.test, and a partner id is no address
    const held = ask(routineToken, "odoo", "odoo_send_message", { record_id: 42, body: "x", partner_ids: [42], dry_run: false });
    const card = await waitFor(async () => (await messages(thread)).find((m) => m.kind === "email"));
    expect(card?.email.mcp).toMatchObject({ server: "odoo" });
    await api("POST", `/api/bots/${runner.id}/email-cards/${card.id}/discard`, { threadId: thread });
    expect((await held).body.action).toBe("refuse");
  }, 90_000);
});
