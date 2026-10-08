// Jabeja fork: where a person was last (server/person-navigation.ts) — read
// by the app to land on the agent and conversation they last used, written
// whenever they open one. Client scope; a person only reads and writes their
// own, and only for agents and conversations they may open.
import type { RequestAuth } from "../request-auth.ts";
import type { PersonNavigation } from "../person-navigation.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ForkNavigationRouteDeps {
  /** The person a request is from; undefined when it is nobody's (a service). */
  personOf(auth: RequestAuth): string | undefined;
  navigation: PersonNavigation;
  /** Whether this request may open this agent's conversation. */
  mayOpen(auth: RequestAuth, botId: string, threadId: string): boolean;
}

export function createForkNavigationRoutes(deps: ForkNavigationRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/people/me/navigation") return PASS;
    const person = deps.personOf(auth);
    if (!person) return json(res, 400, { error: "navigation is per person; this request is nobody's" });
    if (method === "GET") return json(res, 200, { visits: deps.navigation.visits(person) });
    if (method === "PUT") {
      const body = await readBody(req);
      const { botId, threadId } = (body && typeof body === "object" && !Array.isArray(body) ? body : {}) as { botId?: unknown; threadId?: unknown };
      if (typeof botId !== "string" || typeof threadId !== "string") return json(res, 400, { error: "botId and threadId are required" });
      if (!deps.mayOpen(auth, botId, threadId)) return json(res, 404, { error: "no such conversation" });
      if (!deps.navigation.remember(person, botId, threadId)) return json(res, 400, { error: "invalid botId or threadId" });
      return json(res, 200, { ok: true });
    }
    return PASS;
  };
}
