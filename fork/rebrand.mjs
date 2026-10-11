#!/usr/bin/env node
// Jabeja fork only: turn a BUILD COPY of this repo into Hubigen before it is
// built. Upstream's source keeps saying "OpenMausBot" (so fork-sync merges
// stay clean and upstream's tests keep their meaning); every bundle we ship —
// the page, the server, the desktop shell — is built from a copy this script
// renamed, using the one product name in shared/product.json. Text the server
// writes and the page parses stays in step, because both sides are renamed.
//
// Names that are identifiers, not words, are left alone: lowercase
// `openmausbot` (paths, commands, the URL scheme, the npm package), anything
// glued to a path, URL, file extension, version or header
// (github.com/.../OpenMausBot, OpenMausBot.app, OpenMausBot-0.1.43,
// X-OpenMausBot-...), and the helper bundles whose paths the
// build refers to ("OpenMausBot Speech", "OpenMausBot Recorder").
//
// It also drops enterprise/ from the copy (see rebrandTree).
//
//   node fork/rebrand.mjs <build-copy>      rewrites the copy in place
// Refuses a checkout with commits: run it on a copy, never on the repo.
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PRODUCT = JSON.parse(readFileSync(path.join(here, "..", "shared", "product.json"), "utf8"));

const UPSTREAM_NAMES = /(?<![\w./\\-])(?:OpenMaus ?Bot|OpenMaus|MausBot)(?![\w/]|-[\d$]|\.\w| Speech| Recorder)/g;

/** Text with upstream's product names, as people read them, replaced. */
export function rebrandText(text, name = PRODUCT.name) {
  return text.replace(UPSTREAM_NAMES, name);
}

// What ships: the page, the server, the shared code, the desktop shell, the
// phone companion, and the skills bots read.
const TREES = ["src", "server", "shared", "electron", "companion", "skills", "index.html"];
const TEXT = /\.(ts|tsx|mjs|cjs|js|json|html|plist|svg|md|yaml|yml)$/;
const SKIP = /(^|\/)(node_modules|dist[^/]*|release|\.cache)(\/|$)|\.test\.|\.node-test\.|\.app(\/|$)|(^|\/)shared\/product\.json$/;

// Upstream's mascot art, swapped for Hubigen's mark.
const ASSETS = [
  ["fork/hubigen/icon-1024.png", "electron/resources/app-icon.png"],
  ["fork/hubigen/app-icon.svg", "public/app-icon.svg"],
];

function* files(root, rel) {
  const full = path.join(root, rel);
  if (!existsSync(full) || SKIP.test(rel)) return;
  if (statSync(full).isDirectory()) {
    for (const entry of readdirSync(full)) yield* files(root, path.join(rel, entry));
  } else if (TEXT.test(rel)) {
    yield rel;
  }
}

export function rebrandTree(root) {
  // A checkout with history is someone's repo; a build copy has none (an
  // empty .git from an install hook, as on the beast, does not count).
  const history = spawnSync("git", ["-C", root, "rev-parse", "--verify", "-q", "HEAD"], { stdio: "ignore" });
  if (history.status === 0) throw new Error(`${root} is a git checkout with commits; rebrand a build copy, never the repo`);
  const changed = [];
  for (const tree of TREES) {
    for (const rel of files(root, tree)) {
      const file = path.join(root, rel);
      const before = readFileSync(file, "utf8");
      const after = rebrandText(before);
      if (after !== before) {
        writeFileSync(file, after);
        changed.push(rel);
      }
    }
  }
  for (const [from, to] of ASSETS) copyFileSync(path.join(here, "..", from), path.join(root, to));
  // enterprise/ is upstream's source-available layer: reading, building and
  // testing it is allowed, shipping or white-labelling it is not. Hubigen
  // ships the open-source edition, so it leaves the build copy here.
  rmSync(path.join(root, "enterprise"), { recursive: true, force: true });
  return changed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) {
    console.error("usage: node fork/rebrand.mjs <build-copy>");
    process.exit(2);
  }
  const changed = rebrandTree(path.resolve(root));
  console.log(`rebranded ${changed.length} files to ${PRODUCT.name}`);
}
