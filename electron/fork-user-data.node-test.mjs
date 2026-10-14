import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { carryOverRenamedUserData, carryOverUserData } from "./fork-user-data.mjs";

function oldFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fork-user-data-"));
  const from = path.join(root, "openmausbot");
  fs.mkdirSync(path.join(from, "Local Storage", "leveldb"), { recursive: true });
  fs.writeFileSync(path.join(from, "environments.json"), '{"activeId":"jabeja"}');
  fs.writeFileSync(path.join(from, "window-state.json"), "{}");
  fs.writeFileSync(path.join(from, "Local Storage", "leveldb", "000003.log"), "prefs");
  fs.writeFileSync(path.join(from, "credentials.bin"), "encrypted with the old key");
  fs.writeFileSync(path.join(from, "Cookies"), "encrypted with the old key");
  fs.mkdirSync(path.join(from, "Cache"));
  return { root, from, to: path.join(root, "Hubigen") };
}

test("takes over the plain settings, never what the old keychain key encrypted", () => {
  const { from, to } = oldFolder();
  assert.deepEqual(carryOverUserData(from, to).sort(), ["Local Storage", "environments.json", "window-state.json"]);
  assert.equal(fs.readFileSync(path.join(to, "environments.json"), "utf8"), '{"activeId":"jabeja"}');
  assert.equal(fs.readFileSync(path.join(to, "Local Storage", "leveldb", "000003.log"), "utf8"), "prefs");
  for (const name of ["credentials.bin", "Cookies", "Cache"]) assert.equal(fs.existsSync(path.join(to, name)), false, name);
  // the old folder stays as it was (the OpenMausBot app may still use it)
  assert.equal(fs.existsSync(path.join(from, "credentials.bin")), true);
});

test("only once: an existing folder is never touched", () => {
  const { from, to } = oldFolder();
  fs.mkdirSync(to);
  fs.writeFileSync(path.join(to, "environments.json"), '{"activeId":"mine"}');
  assert.deepEqual(carryOverUserData(from, to), []);
  assert.equal(fs.readFileSync(path.join(to, "environments.json"), "utf8"), '{"activeId":"mine"}');
});

test("nothing to carry without an old folder", () => {
  const { root } = oldFolder();
  const to = path.join(root, "Hubigen");
  assert.deepEqual(carryOverUserData(path.join(root, "nope"), to), []);
  assert.equal(fs.existsSync(to), false);
});

test("the app named openmausbot itself is left alone", () => {
  const { root } = oldFolder();
  const app = (name) => ({ getName: () => name, getPath: (key) => key === "appData" ? root : path.join(root, name) });
  assert.deepEqual(carryOverRenamedUserData(app("openmausbot")), []);
  assert.deepEqual(carryOverRenamedUserData(app("Hubigen")).sort(), ["Local Storage", "environments.json", "window-state.json"]);
});
