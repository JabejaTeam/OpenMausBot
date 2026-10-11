// Jabeja fork: whether this is the Hubigen build. fork/hubigen-builder.yml
// stamps `"jabejaBuild": "hubigen"` into the packaged package.json; the app's
// internal name stays "openmausbot" (same data folder and sign-ins as
// OpenMausBot), so app.getName() cannot tell the two apart.
import { app } from "electron";
import { readFileSync } from "node:fs";
import path from "node:path";

function readBuild() {
  try {
    return JSON.parse(readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")).jabejaBuild;
  } catch {
    return undefined;
  }
}

export const HUBIGEN_BUILD = readBuild() === "hubigen";
