// Jabeja fork only: a Hubigen build opens one server and nothing else. Its
// package.json carries `lockedServer` (fork/hubigen-builder.mjs, from
// shared/product.json "server"); that server's sign-in list decides who gets
// in. "This computer" — the embedded server as a workspace of its own — and
// any other server stay out of reach, so a download alone gives no usable
// app (2026-10-17). The embedded server itself still runs: it serves the
// desktop's own plumbing, but its page is never shown.
import fs from "node:fs";
import path from "node:path";

export const LOCKED_ID = "hubigen";

/** The locked server's origin from the app's package.json, or null for an
 * unlocked build (OpenMausBot, dev). Only an https origin counts. */
export function lockedServerOf(pkg) {
  const value = pkg?.lockedServer;
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

export function readLockedServer(appPath) {
  try {
    return lockedServerOf(JSON.parse(fs.readFileSync(path.join(appPath, "package.json"), "utf8")));
  } catch {
    return null;
  }
}

/** The saved list reduced to the locked server, active. An entry already
 * saved for that origin keeps its id, name and microphone grant; everything
 * else (other servers, named local folders) is dropped. */
export function lockEnvironments(state, origin, name) {
  const saved = state.environments.find((entry) => entry.kind !== "local" && entry.origin === origin);
  const entry = saved ? { ...saved, missing: false } : { id: LOCKED_ID, kind: "remote", name, origin, missing: false };
  return { ...state, environments: [entry], activeId: entry.id };
}
