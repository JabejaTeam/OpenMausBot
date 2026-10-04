// Jabeja fork: the 3D office view's own routes, kept out of server/index.ts so
// upstream syncs never touch them. Everyone reads how the offices look; only
// an admin changes them (scopes in server/request-auth.ts).
import { readTeamLooks, writeTeamLook } from "../team-looks.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createForkOfficeRoutes(): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    if (method === "GET" && path === "/api/team-looks") return json(res, 200, { teams: readTeamLooks() });
    const one = path.match(/^\/api\/team-looks\/(.+)$/);
    if (one && method === "PUT") {
      const result = writeTeamLook(decodeURIComponent(one[1]), await readBody(req));
      return result.ok ? json(res, 200, { teams: result.teams }) : json(res, 400, { error: result.error });
    }
    return PASS;
  };
}
