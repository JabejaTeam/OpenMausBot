// Jabeja fork only: a renamed build (Hubigen, fork/hubigen-builder.mjs sets
// productName) gets its own data folder and its own "<name> Safe Storage"
// keychain item. Before that it ran as "openmausbot": it shared both with the
// OpenMausBot app, and macOS asked for the login password whenever that item
// had been made by another signer (2026-10-14).
//
// On its first start the renamed build takes over the plain settings of the
// old folder — which servers it knows, window size, local storage — so
// nobody has to add their server again. Not the *.bin files or the cookies:
// those are encrypted with the old keychain key, so the new one cannot read
// them; signing in once more is the price.
import fs from "node:fs";
import path from "node:path";

export const OLD_NAME = "openmausbot";
const CARRIED_DIRS = ["Local Storage"];

/** Copy the old folder's plain settings into `to`, once: only when `to`
 * does not exist yet and `from` does. Returns the names it copied. */
export function carryOverUserData(from, to) {
  if (from === to || fs.existsSync(to) || !fs.existsSync(from)) return [];
  fs.mkdirSync(to, { recursive: true, mode: 0o700 });
  const copied = [];
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const plainFile = entry.isFile() && entry.name.endsWith(".json");
    const plainDir = entry.isDirectory() && CARRIED_DIRS.includes(entry.name);
    if (!plainFile && !plainDir) continue;
    fs.cpSync(path.join(from, entry.name), path.join(to, entry.name), { recursive: true, preserveTimestamps: true });
    copied.push(entry.name);
  }
  return copied;
}

/** For the Electron app: a build named anything but "openmausbot" carries
 * over that folder's settings before anything reads its own. */
export function carryOverRenamedUserData(app) {
  if (app.getName() === OLD_NAME) return [];
  const to = app.getPath("userData");
  try {
    return carryOverUserData(path.join(app.getPath("appData"), OLD_NAME), to);
  } catch (error) {
    console.warn(`[user-data] could not carry over ${OLD_NAME}: ${error.message}`);
    return [];
  }
}
