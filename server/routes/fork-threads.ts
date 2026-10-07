// Jabeja fork: marking a conversation private, and sharing a private one with
// teammates (server/thread-access.ts holds the rule). The request gate
// already refused anyone the thread is not open to, so these routes only add:
// who may change it (the thread's own person, or the local owner) and who may
// be on the list (people on this workspace's sign-in list).
import type { RequestAuth } from "../request-auth.ts";
import type { SessionRecord } from "../sessions.ts";
import { personKeyForEmail } from "../person-key.ts";
import { personNames, readPersonProfile } from "../person-profiles.ts";
import { MAX_THREAD_SHARES } from "../thread-access.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ForkThreadRouteDeps {
  personKey(session: SessionRecord): string;
  conversationExists(threadId: string): boolean;
  /** Whose the thread is (thread-access.ts threadOwnerPerson). */
  threadOwner(threadId: string): string | undefined;
  shares(threadId: string): readonly string[];
  setShares(threadId: string, people: readonly string[]): boolean;
  isPrivate(threadId: string): boolean;
  setPrivate(threadId: string, value: boolean): boolean;
  /** Everyone signed in here: the sign-in list's admins and members. */
  workspaceEmails(): readonly string[];
  /** Lists and live frames follow the new audience. */
  changed(threadId: string): void;
}

interface Person { key: string; email?: string; name?: string }

export function createForkThreadRoutes(deps: ForkThreadRouteDeps): RouteHandler {
  const describe = (key: string, names: Record<string, string>, emails: Map<string, string>): Person => {
    const email = readPersonProfile(key)?.email ?? emails.get(key);
    return { key, ...(email ? { email } : {}), ...(names[key] ? { name: names[key] } : {}) };
  };
  const mayManage = (auth: RequestAuth, owner: string | undefined) =>
    auth.kind === "loopback" || (auth.kind === "session" && owner !== undefined && owner === deps.personKey(auth.session));

  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = /^\/api\/threads\/([\w-]+)\/shares$/.exec(path);
    if (!m) return PASS;
    const threadId = m[1]!;
    if (!deps.conversationExists(threadId)) return json(res, 404, { error: "no such conversation" });
    const owner = deps.threadOwner(threadId);
    const view = () => {
      const names = personNames();
      const emails = new Map(deps.workspaceEmails().map((email) => [personKeyForEmail(email), email]));
      return {
        owner: owner ? describe(owner, names, emails) : null,
        private: deps.isPrivate(threadId),
        sharedWith: deps.shares(threadId).map((key) => describe(key, names, emails)),
        candidates: [...emails.keys()].filter((key) => key !== owner).map((key) => describe(key, names, emails)),
        canManage: mayManage(auth, owner),
      };
    };
    if (method === "GET") return json(res, 200, view());
    if (method !== "PUT") return json(res, 405, { error: "Use GET or PUT." });
    if (!mayManage(auth, owner)) return json(res, 403, { error: "Only the person this conversation belongs to can change who sees it." });
    const body = await readBody(req);
    const fields = body && typeof body === "object" && !Array.isArray(body) ? body as { people?: unknown; private?: unknown } : {};
    if (typeof fields.private === "boolean" && fields.people === undefined) {
      if (!deps.setPrivate(threadId, fields.private)) return json(res, 400, { error: "That could not be saved." });
      deps.changed(threadId);
      return json(res, 200, view());
    }
    const people = fields.people;
    if (!Array.isArray(people) || people.length > MAX_THREAD_SHARES || people.some((key) => typeof key !== "string")) {
      return json(res, 400, { error: 'Send { "private": true | false } or { "people": ["<person key>", ...] }.' });
    }
    const allowed = new Set(deps.workspaceEmails().map((email) => personKeyForEmail(email)));
    const unknown = (people as string[]).find((key) => !allowed.has(key));
    if (unknown) return json(res, 400, { error: "You can only share with people on this workspace." });
    if (!deps.setShares(threadId, (people as string[]).filter((key) => key !== owner))) {
      return json(res, 400, { error: "That list could not be saved." });
    }
    deps.changed(threadId);
    return json(res, 200, view());
  };
}
