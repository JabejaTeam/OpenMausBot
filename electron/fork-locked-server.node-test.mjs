import assert from "node:assert/strict";
import { test } from "node:test";
import { LOCKED_ID, lockEnvironments, lockedServerOf } from "./fork-locked-server.mjs";

const ORIGIN = "https://bots.jabeja.be";

test("only an https origin locks the app", () => {
  assert.equal(lockedServerOf({ lockedServer: "https://bots.jabeja.be/" }), ORIGIN);
  assert.equal(lockedServerOf({ lockedServer: "http://bots.jabeja.be" }), null);
  assert.equal(lockedServerOf({ lockedServer: "https://a:b@bots.jabeja.be" }), null);
  assert.equal(lockedServerOf({ lockedServer: "not a url" }), null);
  assert.equal(lockedServerOf({ name: "openmausbot" }), null);
});

test("an empty list gets the locked server, active", () => {
  const state = lockEnvironments({ environments: [], activeId: "local" }, ORIGIN, "Hubigen");
  assert.deepEqual(state, { environments: [{ id: LOCKED_ID, kind: "remote", name: "Hubigen", origin: ORIGIN, missing: false }], activeId: LOCKED_ID });
});

test("a saved entry for that server is kept; other servers and folders go", () => {
  const saved = { id: "abc", kind: "remote", name: "Jabeja", origin: ORIGIN, microphone: true, missing: false };
  const state = lockEnvironments({
    environments: [
      { id: "other", kind: "remote", name: "Other", origin: "https://example.com", missing: false },
      { id: "dir", kind: "local", name: "Folder", dataDir: "/tmp/x", missing: false },
      saved,
    ],
    activeId: "local",
  }, ORIGIN, "Hubigen");
  assert.deepEqual(state, { environments: [saved], activeId: "abc" });
});
