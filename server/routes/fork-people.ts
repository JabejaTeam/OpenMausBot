// Jabeja fork: the per-person, phone-pairing and work-rule routes, kept out of
// server/index.ts so upstream syncs never touch them. Scope rules stay keyed
// by path in server/request-auth.ts.
import type { IncomingMessage } from "node:http";
import type { RequestAuth } from "../request-auth.ts";
import type { SessionRecord, SessionRegistry } from "../sessions.ts";
import { isKindInstructionScope, readKindInstructions, writeKindInstructions, KIND_INSTRUCTIONS_MAX_BYTES } from "../kind-instructions.ts";
import { ownMcpServers, withOwnMcpValues } from "../mcp-registry.ts";
import { notePerson, personNames, readPersonProfile, savePersonProfile, PERSON_PROFILE_MAX_LINES } from "../person-profiles.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ForkPeopleRouteDeps {
  personKey(session: SessionRecord): string;
  /** The live config's MCP servers, read per request. */
  mcpServers(): Parameters<typeof ownMcpServers>[0];
  persistMcpServers(next: Record<string, unknown>): void;
  sessions: Pick<SessionRegistry, "isLive" | "openPairing">;
  /** The pairing answer upstream's /api/auth/pairing gives: code, links, hint. */
  pairingOffer(opened: ReturnType<SessionRegistry["openPairing"]>, req: IncomingMessage, auth: RequestAuth): unknown;
  conversationExists(threadId: string): boolean;
  /** The person a thread's work is for, followed through delegation. */
  threadPerson(threadId: string): string | undefined;
}

export function createForkPeopleRoutes(deps: ForkPeopleRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    // A signed-in person pairs their own phone. The code carries their email
    // and exactly their scopes, so the phone is them (private bots, profile,
    // tokens) and ends with their place on the sign-in list. Client scope:
    // a member may do this, but never for anyone else or with more rights.
    if (method === "POST" && path === "/api/auth/pairing/mine") {
      if (auth.kind !== "session" || !auth.session.email) {
        return json(res, 400, { error: "Sign in with your email first; a phone paired from here works as you." });
      }
      if (!deps.sessions.isLive(auth.session.id)) {
        return json(res, 401, { error: "Your session ended. Sign in again before creating a pairing code." });
      }
      const opened = deps.sessions.openPairing({
        label: `${auth.session.email} phone`,
        scopes: [...auth.session.scopes],
        email: auth.session.email,
        ...(auth.session.userId ? { userId: auth.session.userId } : {}),
      });
      return json(res, 200, deps.pairingOffer(opened, req, auth));
    }

    // Who a thread's work is for: the person of its latest turn, else of its
    // current request (delegated threads lead back to whoever asked). For
    // local services such as time keeping; admin scope by default.
    const threadPerson = path.match(/^\/api\/threads\/([\w-]+)\/person$/);
    if (threadPerson && method === "GET") {
      const threadId = threadPerson[1];
      if (!deps.conversationExists(threadId)) return json(res, 404, { error: "no such conversation" });
      const key = deps.threadPerson(threadId);
      const profile = readPersonProfile(key);
      return json(res, 200, { person: key ? { key, ...(profile?.email ? { email: profile.email } : {}), ...(profile?.name ? { name: profile.name } : {}) } : null });
    }

    // ── workspace rules by kind of bot (admin) ──
    if (method === "GET" && path === "/api/kind-instructions") {
      return json(res, 200, { scopes: readKindInstructions(), maxBytes: KIND_INSTRUCTIONS_MAX_BYTES });
    }
    const kindScope = /^\/api\/kind-instructions\/([a-z]+)$/.exec(path);
    if (method === "PUT" && kindScope) {
      if (!isKindInstructionScope(kindScope[1])) return json(res, 404, { error: "No such role." });
      const body = await readBody(req);
      const text = body && typeof body === "object" && !Array.isArray(body) ? (body as { text?: unknown }).text : undefined;
      if (typeof text !== "string") return json(res, 400, { error: 'Send { "text": "..." }.' });
      try {
        return json(res, 200, { scope: kindScope[1], record: writeKindInstructions(kindScope[1], text) });
      } catch (error) {
        return json(res, 400, { error: (error as Error).message });
      }
    }

    // ── who sent what: display names for the people keys messages carry ──
    if (method === "GET" && path === "/api/people/names") {
      return json(res, 200, { names: personNames() });
    }

    // ── a person's own profile (Settings → About me) ──
    // Any signed-in person, members included, reads and edits only their own.
    if (path === "/api/people/me") {
      const email = auth.kind === "session" ? auth.session.email : undefined;
      if (!email || auth.kind !== "session") return json(res, 400, { error: "Sign in with your email address to keep a profile." });
      const key = deps.personKey(auth.session);
      notePerson(key, email);
      const view = () => {
        const profile = readPersonProfile(key);
        return { id: key, email: profile?.email ?? email, name: profile?.name ?? "", text: profile?.text ?? "", maxLines: PERSON_PROFILE_MAX_LINES };
      };
      if (method === "GET") return json(res, 200, view());
      if (method === "PUT") {
        const body = await readBody(req);
        if (!body || typeof body !== "object" || Array.isArray(body)) return json(res, 400, { error: "Send { name?, text? }." });
        const { name, text } = body as { name?: unknown; text?: unknown };
        if ((name !== undefined && typeof name !== "string") || (text !== undefined && typeof text !== "string")) {
          return json(res, 400, { error: "name and text must be strings." });
        }
        const saved = savePersonProfile(key, { name: name as string | undefined, text: text as string | undefined });
        return saved.ok ? json(res, 200, view()) : json(res, 400, { error: saved.error });
      }
      return json(res, 405, { error: "Use GET or PUT." });
    }

    // ── a person's own values on self-service MCP servers ──
    // Any signed-in person, members included: they see which self-service
    // servers exist and which of their own values are set, never a value and
    // never anyone else. The server file changes only in that person's entry.
    if (path === "/api/mcp/mine" || path.startsWith("/api/mcp/mine/")) {
      const email = auth.kind === "session" ? auth.session.email : undefined;
      if (!email) return json(res, 400, { error: "Sign in with your email address to keep your own MCP values." });
      if (method === "GET" && path === "/api/mcp/mine") {
        return json(res, 200, { servers: ownMcpServers(deps.mcpServers(), email) });
      }
      const own = /^\/api\/mcp\/mine\/([a-z][a-z0-9_-]{0,31})$/.exec(path);
      if (own && (method === "PUT" || method === "DELETE")) {
        let values: Record<string, string> | null = null;
        if (method === "PUT") {
          const body = await readBody(req);
          const raw = body && typeof body === "object" && !Array.isArray(body) ? (body as { values?: unknown }).values : undefined;
          if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            return json(res, 400, { error: 'Send { "values": { "<name>": "<value>" } }.' });
          }
          values = raw as Record<string, string>;
        }
        const servers = deps.mcpServers();
        const next = withOwnMcpValues(own[1], servers?.[own[1]], email, values);
        if (!next.ok) return json(res, next.status, { error: next.error });
        deps.persistMcpServers({ ...servers, [own[1]]: next.entry });
        return json(res, 200, { servers: ownMcpServers(deps.mcpServers(), email) });
      }
      return json(res, 405, { error: "Use GET, PUT or DELETE." });
    }
    return PASS;
  };
}
