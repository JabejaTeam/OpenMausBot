import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { controleConfigFromEnv, createControleCard, createControleRoutes, handleControleInternal, signControle } from "./controle-card.ts";
import { PASS } from "./routes/table.ts";

const BOT = "52ebf1de-bb38-479d-bdd5-54705a621de6";
const CLIENT = "c17e764e-fc92-4ae4-89db-802398934235";
const env = { OMB_CONTROLE_URL: "https://admin.example/", OMB_CONTROLE_SECRET: "geheim", OMB_CONTROLE_BOTS: `${BOT}=${CLIENT}, kapot, x=y` };
const config = controleConfigFromEnv(env)!;
const bot = { id: BOT, name: "Controle", color: "green" as const };

function store() {
  const messages: unknown[] = [];
  return { messages, appendMessage: (_thread: string, message: unknown) => (messages.push(message), { id: `m${messages.length}` }) };
}

function call(handler: ReturnType<typeof createControleRoutes>, path: string, body: unknown, method = "POST") {
  const out: { status?: number; body?: unknown } = {};
  const res = {} as never;
  return handler({
    req: {} as never, res, url: new URL(`http://x${path}`), path, method,
    auth: { kind: "session", session: { email: "yren@jabeja.be" } } as never,
    json: ((_res: unknown, status: number, data: unknown) => { out.status = status; out.body = data; }) as never,
    readBody: (async () => body) as never,
  }).then((r) => ({ r, ...out }));
}

function fakeFetch(answer: { status: number; body: unknown }) {
  const calls: { url: string; body: string; signature: string }[] = [];
  const fetcher = async (url: string, init: { body: string; headers: Record<string, string> }) => {
    calls.push({ url, body: init.body, signature: init.headers["x-signature"] });
    return { ok: answer.status < 300, status: answer.status, json: async () => answer.body };
  };
  return { calls, fetcher };
}

describe("controleConfigFromEnv", () => {
  it("reads url, secret and the bot → client pairs, and skips malformed pairs", () => {
    expect(config.url).toBe("https://admin.example");
    expect([...config.bots]).toEqual([[BOT, CLIENT]]);
  });
  it("is off without a secret, a url or any linked bot", () => {
    expect(controleConfigFromEnv({ ...env, OMB_CONTROLE_SECRET: "" })).toBeNull();
    expect(controleConfigFromEnv({ ...env, OMB_CONTROLE_URL: "admin.example" })).toBeNull();
    expect(controleConfigFromEnv({ ...env, OMB_CONTROLE_BOTS: "" })).toBeNull();
  });
});

describe("createControleCard", () => {
  it("puts a card with the linked client in the conversation", () => {
    const s = store();
    expect(createControleCard({ config, store: s, bot, threadId: "t" })).toEqual({ ok: true, messageId: "m1" });
    expect(s.messages[0]).toMatchObject({ kind: "controle", controle: { clientId: CLIENT }, from: { botId: BOT } });
  });
  it("refuses a bot that is not linked to a client", () => {
    const s = store();
    expect(createControleCard({ config, store: s, bot: { ...bot, id: "ander" }, threadId: "t" })).toMatchObject({ ok: false, status: 403 });
    expect(createControleCard({ config: null, store: s, bot, threadId: "t" })).toMatchObject({ ok: false, status: 403 });
    expect(s.messages).toEqual([]);
  });
});

describe("createControleRoutes", () => {
  const routes = (fetcher: unknown, botThread = true) => createControleRoutes({ config: () => config, personName: () => "Yren Delhaye", botThread: () => botThread, fetch: fetcher as never });

  it("leaves other paths alone", async () => {
    expect((await call(routes(null), "/api/bots/x/email-cards/y/send", {})).r).toBe(PASS);
  });

  it("refuses a bot without a client and a conversation of another bot", async () => {
    expect((await call(routes(null), "/api/bots/ander/controle/wijzigingen", { threadId: "t" })).status).toBe(404);
    expect((await call(routes(null, false), `/api/bots/${BOT}/controle/wijzigingen`, { threadId: "t" })).status).toBe(404);
  });

  it("asks jabeja-admin for its own client, signed with the shared secret", async () => {
    const { calls, fetcher } = fakeFetch({ status: 200, body: { klant: "A&D", wijzigingen: [], link: "l" } });
    const out = await call(routes(fetcher), `/api/bots/${BOT}/controle/wijzigingen`, { threadId: "t", clientId: "ander" });
    expect(out).toMatchObject({ status: 200, body: { klant: "A&D" } });
    expect(calls[0].url).toBe("https://admin.example/api/external/controle/wijzigingen");
    expect(JSON.parse(calls[0].body)).toEqual({ clientId: CLIENT });
    expect(calls[0].signature).toBe("sha256=" + createHmac("sha256", "geheim").update(calls[0].body).digest("hex"));
    expect(calls[0].signature).toBe(signControle(calls[0].body, "geheim"));
  });

  it("passes a decision on as the person who clicked; rejecting needs feedback", async () => {
    const { calls, fetcher } = fakeFetch({ status: 200, body: { aantal: 2 } });
    expect((await call(routes(fetcher), `/api/bots/${BOT}/controle/besluit`, { threadId: "t", besluit: "fout", beeldIds: ["a"] })).status).toBe(400);
    expect((await call(routes(fetcher), `/api/bots/${BOT}/controle/besluit`, { threadId: "t", besluit: "misschien", beeldIds: ["a"] })).status).toBe(400);
    const out = await call(routes(fetcher), `/api/bots/${BOT}/controle/besluit`, { threadId: "t", besluit: "fout", beeldIds: ["a", "b"], feedback: " knop rechts " });
    expect(out).toMatchObject({ status: 200, body: { aantal: 2 } });
    expect(JSON.parse(calls[0].body)).toEqual({ clientId: CLIENT, beeldIds: ["a", "b"], besluit: "fout", feedback: "knop rechts", door: "Yren Delhaye" });
  });

  it("says when jabeja-admin is unreachable", async () => {
    const out = await call(routes(async () => { throw new Error("down"); }), `/api/bots/${BOT}/controle/wijzigingen`, { threadId: "t" });
    expect(out.status).toBe(502);
  });
});

describe("handleControleInternal", () => {
  const base = { method: "POST", config, store: store(), sender: bot, threadId: "t", requireActive: () => {} };
  it("only answers its own path", async () => {
    expect(await handleControleInternal({ ...base, path: "/api/internal/options-card", ownsThread: true })).toBeNull();
  });
  it("refuses a conversation the bot does not own", async () => {
    expect(await handleControleInternal({ ...base, path: "/api/internal/controle-card", ownsThread: false })).toMatchObject({ status: 403 });
  });
  it("creates the card", async () => {
    expect(await handleControleInternal({ ...base, path: "/api/internal/controle-card", ownsThread: true })).toMatchObject({ status: 201 });
  });
});
