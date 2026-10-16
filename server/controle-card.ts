// Jabeja fork: the controle card. A bot that is linked to a client (env
// OMB_CONTROLE_BOTS) can show it with show_controle_card; the card then reads
// what is left to review for that client straight from the testlab on beast
// (hermes-ops ops/testlab, one item per roadmap card, then the loose changes)
// and passes each click on as the person who clicked. No model turn per
// click: the bot only puts the card in the chat.
//
//   OMB_CONTROLE_URL     https://dev-adtrucks.jabeja.be/__testlab
//   OMB_CONTROLE_SECRET  shared with the testlab (HMAC)
//   OMB_CONTROLE_BOTS    <botId>=<clientId>,<botId>=<clientId>
import { createHmac } from "node:crypto";
import type { RequestAuth } from "./request-auth.ts";
import type { MausColor } from "../shared/wire.ts";
import type { ControleCardData } from "../shared/controle-card.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface ControleConfig {
  url: string;
  secret: string;
  /** bot id → jabeja-admin client id */
  bots: Map<string, string>;
}

/** The config from the environment, or null when the feature is off. */
export function controleConfigFromEnv(env: NodeJS.ProcessEnv): ControleConfig | null {
  const url = env.OMB_CONTROLE_URL?.trim().replace(/\/+$/, "");
  const secret = env.OMB_CONTROLE_SECRET?.trim();
  const bots = new Map<string, string>();
  for (const pair of (env.OMB_CONTROLE_BOTS ?? "").split(",")) {
    const [bot, client] = pair.split("=").map((part) => part.trim());
    if (bot && /^[\w-]+$/.test(bot) && client && /^[0-9a-f-]{36}$/i.test(client)) bots.set(bot, client);
  }
  if (!url || !/^https?:\/\//.test(url) || !secret || bots.size === 0) return null;
  return { url, secret, bots };
}

export function signControle(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

async function jabeja(config: ControleConfig, path: string, body: Record<string, unknown>, fetcher: Fetch) {
  const raw = JSON.stringify(body);
  const res = await fetcher(`${config.url}/api/external/controle${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signControle(raw, config.secret) },
    body: raw,
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => null) as Record<string, unknown> | null;
  return { ok: res.ok, status: res.status, data };
}

interface ControleBot {
  id: string;
  name: string;
  color: MausColor;
}

export interface ControleCardStore {
  appendMessage(threadId: string, message: {
    role: "bot";
    kind: "controle";
    text: string;
    from: { botId: string; name: string; color: MausColor };
    controle: ControleCardData;
  }): { id: string };
}

/** show_controle_card: put one card in the bot's conversation. */
export function createControleCard(args: { config: ControleConfig | null; store: ControleCardStore; bot: ControleBot; threadId: string }):
  { ok: true; messageId: string } | { ok: false; status: 403; error: string } {
  const clientId = args.config?.bots.get(args.bot.id);
  if (!clientId) return { ok: false, status: 403, error: "show_controle_card is not enabled for this bot." };
  const message = args.store.appendMessage(args.threadId, {
    role: "bot",
    kind: "controle",
    // Clients without the card show this line instead.
    text: "Controle: de wijzigingen staan klaar om te bekijken.",
    from: { botId: args.bot.id, name: args.bot.name, color: args.bot.color },
    controle: { clientId },
  });
  return { ok: true, messageId: message.id };
}

/**
 * A delivery:"post" webhook to a controle bot (the testlab's "wacht"): a card
 * in that webhook's one fixed thread instead of the payload text. No model
 * turn and no new conversation per notice; the card reads the list live.
 * False for every other bot, which then gets the plain text as usual.
 */
export function postControleCard(args: { config: ControleConfig | null; store: ControleCardStore; bot: ControleBot; threadId: string }): boolean {
  return createControleCard(args).ok;
}

export interface ControleRouteDeps {
  config(): ControleConfig | null;
  /** The display name of whoever is asking: profile name, else email. */
  personName(auth: RequestAuth): string;
  /** The conversation belongs to this bot (the gate already checked the person may open it). */
  botThread(botId: string, threadId: string): boolean;
  fetch?: Fetch;
}

/**
 * The card's own two calls. The global gate has already checked that the
 * person may see the bot and open body.threadId (server/request-auth.ts lists
 * these paths for members).
 */
export function createControleRoutes(deps: ControleRouteDeps): RouteHandler {
  return async ({ req, path, method, auth, json, res, readBody }) => {
    const match = path.match(/^\/api\/bots\/([\w-]+)\/controle\/(wijzigingen|besluit)$/);
    if (!match || method !== "POST") return PASS;
    const [, botId, action] = match;
    const config = deps.config();
    const clientId = config?.bots.get(botId);
    if (!config || !clientId) return json(res, 404, { error: "This bot has no controle card." });
    const body = (await readBody(req)) as Record<string, unknown> | null;
    const threadId = typeof body?.threadId === "string" ? body.threadId : "";
    if (!deps.botThread(botId, threadId)) return json(res, 404, { error: "no such conversation" });
    const fetcher = deps.fetch ?? (fetch as unknown as Fetch);
    try {
      if (action === "wijzigingen") {
        const result = await jabeja(config, "/wijzigingen", { clientId }, fetcher);
        return json(res, result.ok ? 200 : 502, result.ok ? result.data : { error: "het testlab gaf geen antwoord" });
      }
      const besluit = body?.besluit;
      const beeldIds = body?.beeldIds;
      // A roadmap card can be approved without any screenshot (no visual change).
      const kaartId = typeof body?.kaartId === "string" && /^[0-9a-f-]{36}$/i.test(body.kaartId) ? body.kaartId : undefined;
      const feedback = typeof body?.feedback === "string" ? body.feedback.trim().slice(0, 4000) : "";
      if ((besluit !== "goed" && besluit !== "fout") || !Array.isArray(beeldIds) || (!beeldIds.length && !kaartId) || !beeldIds.every((id) => typeof id === "string")) {
        return json(res, 400, { error: "Expected besluit goed|fout and beeldIds or kaartId." });
      }
      if (besluit === "fout" && !feedback) return json(res, 400, { error: "Schrijf wat er anders moet." });
      const result = await jabeja(config, "/besluit", { clientId, ...(kaartId ? { kaartId } : {}), beeldIds, besluit, ...(feedback ? { feedback } : {}), door: deps.personName(auth) }, fetcher);
      if (!result.ok) return json(res, result.status === 400 || result.status === 404 ? result.status : 502, { error: String(result.data?.error ?? "Opslaan mislukt") });
      return json(res, 200, { aantal: result.data?.aantal ?? 0 });
    } catch (error) {
      console.error("[controle]", error instanceof Error ? error.message : error);
      return json(res, 502, { error: "het testlab is niet bereikbaar" });
    }
  };
}

/**
 * The internal call behind show_controle_card, kept here so server/index.ts
 * only forwards to it (its route ratchet allows no new path guards).
 */
export async function handleControleInternal(args: {
  path: string;
  method: string;
  config: ControleConfig | null;
  store: ControleCardStore;
  sender: ControleBot;
  threadId: string;
  ownsThread: boolean;
  requireActive(): void;
}): Promise<null | { status: number; body: Record<string, unknown> }> {
  if (args.method !== "POST" || args.path !== "/api/internal/controle-card") return null;
  if (!args.ownsThread) return { status: 403, body: { error: "source conversation does not belong to sender" } };
  args.requireActive();
  const result = createControleCard({ config: args.config, store: args.store, bot: args.sender, threadId: args.threadId });
  return result.ok ? { status: 201, body: { messageId: result.messageId } } : { status: result.status, body: { error: result.error } };
}
