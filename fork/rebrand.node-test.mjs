// node --test fork/rebrand.node-test.mjs
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PRODUCT, rebrandText, rebrandTree } from "./rebrand.mjs";

test("the product name comes from shared/product.json", () => {
  assert.equal(PRODUCT.name, "Hubigen");
});

test("names people read are renamed", () => {
  for (const [before, after] of [
    ["Welcome to OpenMausBot.", "Welcome to Hubigen."],
    ["Quit OpenMaus Bot", "Quit Hubigen"],
    ["Sign in to MausBot Cloud", "Sign in to Hubigen Cloud"],
    ["Your OpenMaus Admin license", "Your Hubigen Admin license"],
    ["OpenMausBot's data folder", "Hubigen's data folder"],
    ['title: "OpenMausBot"', 'title: "Hubigen"'],
    ["<title>OpenMausBot</title>", "<title>Hubigen</title>"],
    ["(OpenMausBot)", "(Hubigen)"],
    ["in der OpenMausBot-App", "in der Hubigen-App"],
    ["No OpenMaus-managed computers", "No Hubigen-managed computers"],
    ['io.log("\\nWelcome to OpenMausBot\\n")', 'io.log("\\nWelcome to Hubigen\\n")'],
    ["/another bot in this OpenMausBot workspace/", "/another bot in this Hubigen workspace/"],
  ]) assert.equal(rebrandText(before), after, before);
});

test("identifiers stay", () => {
  for (const text of [
    "openmausbot fleet",
    "~/.openmausbot",
    "openmausbot://install",
    "https://github.com/milind-soni/OpenMausBot/releases",
    "OpenMausBot.app/Contents",
    "OpenMausBot-0.1.44-amd64.deb",
    "X-OpenMausBot-Desktop-Owner",
    "electron/resources/OpenMausBot Speech.app",
    "OpenMausBot Recorder.app",
    "OpenMausBotish",
    "SupaOpenMausBot",
  ]) assert.equal(rebrandText(text), text, text);
});

test("a tree is renamed in its shipped parts only, and a checkout with commits is refused", () => {
  const root = mkdtempSync(path.join(tmpdir(), "rebrand-"));
  for (const dir of ["src", "server", "electron/resources", "public", "src/node_modules/x"]) mkdirSync(path.join(root, dir), { recursive: true });
  writeFileSync(path.join(root, "src/a.ts"), 'export const n = "OpenMausBot";');
  writeFileSync(path.join(root, "src/a.test.ts"), 'expect("OpenMausBot")');
  writeFileSync(path.join(root, "src/node_modules/x/i.js"), "OpenMausBot");
  writeFileSync(path.join(root, "server/s.ts"), "in OpenMausBot.");
  mkdirSync(path.join(root, "enterprise/server"), { recursive: true });
  writeFileSync(path.join(root, "enterprise/server/index.ts"), "OpenMausBot");
  const changed = rebrandTree(root);
  assert.deepEqual(changed.sort(), ["server/s.ts", "src/a.ts"]);
  assert.equal(readFileSync(path.join(root, "src/a.test.ts"), "utf8"), 'expect("OpenMausBot")');
  assert.equal(readFileSync(path.join(root, "server/s.ts"), "utf8"), "in Hubigen.");
  assert.equal(existsSync(path.join(root, "enterprise")), false, "enterprise/ is not shipped");
  assert.throws(() => rebrandTree(path.join(import.meta.dirname, "..")), /git checkout with commits/);
});
