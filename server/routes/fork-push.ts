// Jabeja fork: a signed-in phone registers its APNs token for pushes while
// the app is closed (server/push-devices.ts, server/apns.ts). Only for the
// session's own person; sign-out removes it again. A desk (the Mac app, a
// browser) says its person is working there, so their phone stays quiet
// (server/push-gate.ts).
import type { RequestAuth } from "../request-auth.ts";
import type { PushDevices } from "../push-devices.ts";
import type { PushGate } from "../push-gate.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ForkPushRouteDeps {
  /** Who the session acts as: the same key a `notify` frame's forPerson uses. */
  personOf(auth: RequestAuth & { kind: "session" }): string;
  devices: Pick<PushDevices, "register" | "remove">;
  /** The person a desk request is from; undefined when it is nobody's (a service). */
  deskPersonOf(auth: RequestAuth): string | undefined;
  gate: Pick<PushGate, "noteDesk">;
}

export function createForkPushRoutes(deps: ForkPushRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/push/desk" && method === "POST") {
      const person = deps.deskPersonOf(auth);
      if (!person) return json(res, 400, { error: "a desk is a person's; this request is nobody's" });
      deps.gate.noteDesk(person);
      return json(res, 200, { ok: true });
    }
    if (path !== "/api/push/device") return PASS;
    if (auth.kind !== "session") return json(res, 400, { error: "Push is for a signed-in phone." });
    const body = (await readBody(req)) as { token?: unknown; environment?: unknown; topic?: unknown } | null;
    if (method === "POST") {
      const ok = deps.devices.register({
        token: body?.token,
        environment: body?.environment,
        topic: body?.topic,
        person: deps.personOf(auth),
        sessionId: auth.session.id,
      });
      return ok ? json(res, 200, { ok: true }) : json(res, 400, { error: "token, environment (production|sandbox) and topic are required" });
    }
    if (method === "DELETE") {
      if (typeof body?.token === "string") deps.devices.remove(body.token);
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "method_not_allowed" });
  };
}
