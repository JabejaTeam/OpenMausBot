// Fork: the stdio pass-through every custom MCP server with an `outbound`
// setting is mounted behind (server/mcp-mail.ts). The engine talks to this
// process instead of the server; every frame is relayed, except a tools/call
// that sends a message: that one is held while OpenMausBot shows the person
// the email card, then goes upstream with their edits, or is answered with a
// refusal the bot can read. It runs in front of the server whatever the
// engine's approval mode, so Full access cannot skip it.
//
// Settings arrive as one private environment record named on argv
// (`--config-env OPENMAUSBOT_MAIL_GATE_<64 hex>`): Codex shares one environment
// between all its MCP children, and the server's own credentials must never
// reach argv.
//
// stdout is the MCP transport. Never log there.
import { spawn } from "node:child_process";
import { request } from "node:http";
import { createInterface } from "node:readline";

import { resolveCliSpawn } from "./env-path.ts";
import { MAIL_GATE_ENV, outgoingRule, parseMcpMailSpec, UNREACHABLE_TEXT, type McpMailSpec } from "./mcp-mail.ts";
import { killCliTree } from "./procs.ts";

type Json = Record<string, unknown>;

interface Settings {
  name: string;
  spec: McpMailSpec;
  upstream: { command: string; args: string[]; env: Record<string, string> };
  /** The harness, and this turn's bearer for /api/internal/mcp-mail. */
  url: string;
  token: string;
}

function fail(message: string): never {
  process.stderr.write(`mcp-mail-gate: ${message}\n`);
  process.exit(1);
}

function settings(): Settings {
  const envName = process.argv[3];
  if (process.argv.length !== 4 || process.argv[2] !== "--config-env" || !envName || !MAIL_GATE_ENV.test(envName)) fail("invalid arguments");
  let value: Json;
  try {
    value = JSON.parse(process.env[envName] ?? "");
  } catch {
    fail("invalid private configuration");
  }
  const spec = parseMcpMailSpec(value?.spec);
  const upstream = value?.upstream as Settings["upstream"] | undefined;
  if (typeof value?.name !== "string" || !spec.ok || typeof value.url !== "string" || typeof value.token !== "string"
    || !upstream || typeof upstream.command !== "string" || !upstream.command) fail("invalid private configuration");
  return { name: value.name, spec: spec.spec, upstream: { command: upstream.command, args: upstream.args ?? [], env: upstream.env ?? {} }, url: value.url, token: value.token };
}

const config = settings();

const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const idKey = (id: unknown) => typeof id === "string" || typeof id === "number" ? `${typeof id}:${id}` : undefined;

/** POST to the harness and wait as long as the person takes. No timeout
 * here: the harness ends the hold itself, and the engine cancels it. */
function ask(path: string, body: unknown, signal?: AbortSignal): Promise<Json> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(new URL(path, config.url), {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", "content-length": Buffer.byteLength(data) },
      signal,
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { text += chunk; });
      res.on("end", () => {
        try {
          const parsed: unknown = JSON.parse(text);
          if ((res.statusCode ?? 500) >= 300 || !isRecord(parsed)) return reject(new Error(`harness answered ${res.statusCode}`));
          resolve(parsed);
        } catch (error) {
          reject(error as Error);
        }
      });
    });
    req.on("error", reject);
    req.end(data);
  });
}

const childEnv: NodeJS.ProcessEnv = { ...process.env, ...config.upstream.env };
for (const name of Object.keys(childEnv)) if (MAIL_GATE_ENV.test(name)) delete childEnv[name];
const resolved = resolveCliSpawn(config.upstream.command, config.upstream.args);
const child = spawn(resolved.command, resolved.args, {
  stdio: ["pipe", "pipe", "pipe"],
  env: childEnv,
  shell: false,
  ...(process.platform === "win32" ? { windowsHide: true } : {}),
});
let reaping = false;
const reapChild = () => {
  if (reaping) return;
  reaping = true;
  void killCliTree(child);
};
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    reapChild();
    process.exit(0);
  });
}
process.on("exit", reapChild);
child.on("error", (error) => fail(`could not start ${resolved.command}: ${String(error)}`));
child.stderr.pipe(process.stderr);
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));

const toClient = (message: unknown): void => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};
const refuse = (id: unknown, text: string) => toClient({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: true } });

/** Calls waiting on the person, by request id: cancelling one ends the wait. */
const holding = new Map<string, AbortController>();
/** Calls the person sent: their card hears the outcome, the bot a note. */
const sent = new Map<string, { cardId: string; note?: string }>();

async function hold(message: Json, params: Json, key: string): Promise<void> {
  const controller = new AbortController();
  holding.set(key, controller);
  let answer: Json;
  try {
    answer = await ask("/api/internal/mcp-mail", { server: config.name, tool: params.name, arguments: params.arguments ?? {} }, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
    process.stderr.write(`mcp-mail-gate(${config.name}): ${String(error)}\n`);
    answer = { action: "refuse", text: UNREACHABLE_TEXT };
  } finally {
    holding.delete(key);
  }
  if (answer.action !== "send" || !isRecord(answer.arguments)) {
    return refuse(message.id, typeof answer.text === "string" ? answer.text : UNREACHABLE_TEXT);
  }
  if (typeof answer.cardId === "string") sent.set(key, { cardId: answer.cardId, ...(typeof answer.note === "string" ? { note: answer.note } : {}) });
  child.stdin.write(`${JSON.stringify({ ...message, params: { ...params, arguments: answer.arguments } })}\n`);
}

// client -> server
createInterface({ input: process.stdin }).on("line", (line) => {
  let message: Json | undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed)) message = parsed;
  } catch {
    /* not ours to read: relayed as it came */
  }
  const params = isRecord(message?.params) ? message.params : undefined;
  if (message?.method === "notifications/cancelled") {
    const key = idKey(params?.requestId);
    const waiting = key ? holding.get(key) : undefined;
    if (waiting) {
      waiting.abort();
      return;
    }
  }
  if (message?.method === "tools/call" && typeof params?.name === "string" && outgoingRule(config.spec, params.name, params.arguments)) {
    const key = idKey(message.id);
    // A sending call without an id cannot be answered, so it never runs.
    if (!key) return;
    void hold(message, params, key);
    return;
  }
  child.stdin.write(`${line}\n`);
});
process.stdin.on("end", () => {
  // Calls still waiting on the person are dropped with the connection.
  for (const controller of holding.values()) controller.abort();
  child.stdin.end();
});

// server -> client
createInterface({ input: child.stdout }).on("line", (line) => {
  let message: Json | undefined;
  try {
    const parsed: unknown = JSON.parse(line);
    if (isRecord(parsed)) message = parsed;
  } catch {
    /* relayed below */
  }
  const key = message && typeof message.method !== "string" ? idKey(message.id) : undefined;
  const outcome = key ? sent.get(key) : undefined;
  if (!message || !key || !outcome) {
    process.stdout.write(`${line}\n`);
    return;
  }
  sent.delete(key);
  const result = isRecord(message.result) ? message.result : undefined;
  const failed = message.error !== undefined || result?.isError === true;
  const error = failed
    ? (isRecord(message.error) && typeof message.error.message === "string" ? message.error.message
      : Array.isArray(result?.content) ? result.content.map((block: unknown) => isRecord(block) && typeof block.text === "string" ? block.text : "").join(" ").trim() : "")
    : undefined;
  void ask("/api/internal/mcp-mail/done", { cardId: outcome.cardId, ok: !failed, ...(error ? { error: error.slice(0, 240) } : {}) }).catch(() => undefined);
  if (result && outcome.note) {
    result.content = [...(Array.isArray(result.content) ? result.content : []), { type: "text", text: outcome.note }];
  }
  toClient(message);
});
