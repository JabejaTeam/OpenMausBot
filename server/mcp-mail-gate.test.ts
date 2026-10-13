// The mail gate as a real process, between a scripted engine (this test) and
// a scripted upstream server, with a fake harness answering for the person.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { UNREACHABLE_TEXT } from "./mcp-mail.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE = join(HERE, "mcp-mail-gate.ts");
const ENV_NAME = `OPENMAUSBOT_MAIL_GATE_${"a".repeat(64)}`;

/** Records every call it runs, answers each with "ran <tool>". */
const UPSTREAM = `
const { createInterface } = require("node:readline");
const { appendFileSync } = require("node:fs");
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "tools/call") appendFileSync(process.env.CALLS, JSON.stringify(msg.params) + "\\n");
  if (msg.id === undefined) return;
  const result = msg.method === "tools/call" ? { content: [{ type: "text", text: "ran " + msg.params.name }] } : { echoed: msg.method };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\\n");
});
`;

type Handler = (body: Record<string, unknown>, req: IncomingMessage, res: ServerResponse) => void;

describe("mcp-mail-gate", () => {
  let scratch: string;
  let gate: ChildProcessWithoutNullStreams | undefined;
  let harness: Server | undefined;
  let lines: string[];
  let waiting: Array<(line: string) => void>;
  let asked: Array<{ path: string; auth?: string; body: Record<string, unknown> }>;
  let onAsk: Handler;

  const startHarness = async (): Promise<string> => {
    harness = createServer((req, res) => {
      let text = "";
      req.on("data", (chunk) => { text += chunk; });
      req.on("end", () => {
        const body = JSON.parse(text) as Record<string, unknown>;
        asked.push({ path: req.url ?? "", auth: req.headers.authorization, body });
        if (req.url === "/api/internal/mcp-mail/done") return res.end("{}");
        onAsk(body, req, res);
      });
    });
    await new Promise<void>((resolve) => harness!.listen(0, "127.0.0.1", resolve));
    const address = harness.address();
    return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  };

  const start = (url: string) => {
    const upstreamJs = join(scratch, "upstream.cjs");
    writeFileSync(upstreamJs, UPSTREAM);
    gate = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", GATE, "--config-env", ENV_NAME], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        [ENV_NAME]: JSON.stringify({
          name: "outlook",
          spec: { preset: "ms365" },
          upstream: { command: process.execPath, args: [upstreamJs], env: { CALLS: join(scratch, "calls.jsonl") } },
          url,
          token: "bearer-1",
        }),
      },
    }) as ChildProcessWithoutNullStreams;
    createInterface({ input: gate.stdout }).on("line", (line) => {
      const next = waiting.shift();
      if (next) next(line);
      else lines.push(line);
    });
  };
  const send = (message: unknown) => gate!.stdin.write(`${JSON.stringify(message)}\n`);
  const next = () => new Promise<Record<string, unknown>>((resolve) => {
    const take = (line: string) => resolve(JSON.parse(line));
    const queued = lines.shift();
    if (queued) take(queued);
    else waiting.push(take);
  });
  const calls = () => existsSync(join(scratch, "calls.jsonl"))
    ? readFileSync(join(scratch, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))
    : [];
  const call = (id: number, name: string, args: Record<string, unknown>) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const mail = { body: { Message: { subject: "Offerte", toRecipients: [{ emailAddress: { address: "jan@klant.be" } }], body: { contentType: "Text", content: "Dag Jan" } } } };

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "omb-mail-gate-"));
    lines = [];
    waiting = [];
    asked = [];
    onAsk = (_body, _req, res) => res.end(JSON.stringify({ action: "refuse", text: "no" }));
  });
  afterEach(async () => {
    gate?.kill();
    gate = undefined;
    await new Promise<void>((resolve) => harness ? harness.close(() => resolve()) : resolve());
    harness = undefined;
    removeTempDir(scratch);
  });

  it("relays every call that sends nothing, without asking anyone", async () => {
    start(await startHarness());
    send(call(1, "list-mail-messages", { top: 5 }));
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ran list-mail-messages" }] } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(await next()).toMatchObject({ id: 2, result: { echoed: "tools/list" } });
    expect(asked).toEqual([]);
  });

  it("holds a send, then runs it with the person's edits and tells the bot", async () => {
    onAsk = (body, _req, res) => {
      const args = body.arguments as typeof mail;
      res.end(JSON.stringify({
        action: "send",
        arguments: { ...args, body: { Message: { ...args.body.Message, subject: "Offerte (herzien)" } } },
        cardId: "card-1",
        note: "Note from OpenMausBot: the person chose Send.",
      }));
    };
    start(await startHarness());
    send(call(3, "send_mail", mail));
    const answer = await next();
    expect(asked[0]).toMatchObject({ path: "/api/internal/mcp-mail", auth: "Bearer bearer-1", body: { server: "outlook", tool: "send_mail", arguments: mail } });
    expect(calls()).toEqual([{ name: "send_mail", arguments: { body: { Message: { ...mail.body.Message, subject: "Offerte (herzien)" } } } }]);
    expect(answer).toEqual({ jsonrpc: "2.0", id: 3, result: { content: [
      { type: "text", text: "ran send_mail" },
      { type: "text", text: "Note from OpenMausBot: the person chose Send." },
    ] } });
    await expect.poll(() => asked.find((entry) => entry.path === "/api/internal/mcp-mail/done")?.body).toEqual({ cardId: "card-1", ok: true });
  });

  it("answers a discarded mail with a refusal and never runs it", async () => {
    onAsk = (_body, _req, res) => res.end(JSON.stringify({ action: "refuse", text: "the person discarded this message" }));
    start(await startHarness());
    send(call(4, "reply-mail-message", { messageId: "m", body: { comment: "ok" } }));
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 4, result: { content: [{ type: "text", text: "the person discarded this message" }], isError: true } });
    expect(calls()).toEqual([]);
  });

  it("fails closed when the harness cannot be reached", async () => {
    const url = await startHarness();
    await new Promise<void>((resolve) => harness!.close(() => resolve()));
    harness = undefined;
    start(url);
    send(call(5, "send-mail", mail));
    expect(await next()).toEqual({ jsonrpc: "2.0", id: 5, result: { content: [{ type: "text", text: UNREACHABLE_TEXT }], isError: true } });
    expect(calls()).toEqual([]);
  });

  it("stops waiting when the engine cancels the call, and the harness sees it go", async () => {
    let closed = false;
    onAsk = (_body, _req, res) => { res.on("close", () => { closed = true; }); };
    start(await startHarness());
    send(call(6, "send-mail", mail));
    await expect.poll(() => asked.length).toBe(1);
    send({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 6 } });
    await expect.poll(() => closed).toBe(true);
    send(call(7, "list-mail-messages", {}));
    expect(await next()).toMatchObject({ id: 7 });
    expect(calls().map((entry: { name: string }) => entry.name)).toEqual(["list-mail-messages"]);
  });
});
