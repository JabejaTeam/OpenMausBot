// Fork: one git worktree per thread for bots with `threadWorktrees`.
//
// Several threads of one code bot may run at once. In one shared folder they
// would overwrite each other's files and commits, so the project folder
// (bot.cwd) is refused to a second writer (workspace_busy). With this flag a
// new thread instead pins to its own worktree of that repo, on its own branch
// from the folder's current branch. The thread lands finished work by
// fast-forwarding that branch, so the shared folder only ever holds merged
// work — and is what its dev preview shows.
import { execFile, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { DATA_DIR } from "./config.ts";
import { augmentedPath } from "./env-path.ts";

const exec = promisify(execFile);
// The server's own PATH can be minimal (launchd); git and cp come from the
// same augmented PATH the engines get.
const env = () => ({ ...process.env, PATH: augmentedPath() });
const run = (cmd: string, args: string[]) => exec(cmd, args, { env: env() });
export const THREAD_WORKTREES_DIR = join(DATA_DIR, "worktrees");

export function threadWorktreePath(botId: string, threadId: string): string {
  if (![botId, threadId].every((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id))) {
    throw new Error("Invalid bot or thread id for a thread worktree.");
  }
  return join(THREAD_WORKTREES_DIR, botId, threadId);
}

export function threadWorktreeBranch(threadId: string): string {
  return `omb/${threadId}`;
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: env() }).trim();
}

/** The branch the project folder has checked out: the one threads land on. */
export function projectBranch(repo: string): string {
  return git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

/** node_modules at the root and one level down come along, so the copy can
 * typecheck without a fresh install: cloned copy-on-write on macOS, hard-linked
 * elsewhere (instant, no extra disk; an `npm ci` in the copy replaces its own
 * links and never touches the shared folder). A copy that cannot be made, for
 * instance across filesystems, is left out: the thread then installs itself. */
async function copyDependencies(repo: string, path: string): Promise<void> {
  const flags = process.platform === "darwin" ? "-cR" : "-al";
  const dirs = ["", ...readdirSync(repo).filter((name) => !name.startsWith(".") && name !== "node_modules" &&
    statSync(join(repo, name)).isDirectory() && existsSync(join(path, name)))];
  for (const dir of dirs) {
    const source = join(repo, dir, "node_modules");
    const target = join(path, dir, "node_modules");
    if (existsSync(source) && !existsSync(target)) await run("cp", [flags, source, target]).catch(() => undefined);
  }
}

/** Create (once) the thread's worktree and return its path. Untracked .env*
 * files at the repo root are copied (they hold the local settings a checkout
 * lacks), and so are its dependencies (copyDependencies). */
export async function ensureThreadWorktree(repo: string, botId: string, threadId: string): Promise<string> {
  const path = threadWorktreePath(botId, threadId);
  if (existsSync(join(path, ".git"))) return path;
  mkdirSync(join(THREAD_WORKTREES_DIR, botId), { recursive: true, mode: 0o700 });
  const branch = threadWorktreeBranch(threadId);
  await run("git", ["-C", repo, "worktree", "add", "-B", branch, path, projectBranch(repo)]);
  for (const name of readdirSync(repo)) {
    if (name.startsWith(".env") && !existsSync(join(path, name)) && statSync(join(repo, name)).isFile()) {
      copyFileSync(join(repo, name), join(path, name));
    }
  }
  await copyDependencies(repo, path);
  return path;
}

/** Landing a thread's work, as one command the thread runs once it committed:
 * rebase onto the project branch, typecheck again when that brought in other
 * merged work, fast-forward the project branch, print the merged hash. Retries
 * when the project branch moves on in between. One step instead of several
 * turns of the engine, and the one place the landing rules live. */
const LAND_SCRIPT = `#!/usr/bin/env bash
# OpenMausBot: land this worktree's branch on the shared folder's branch.
# Usage: land.sh <shared folder> <branch>   (run inside the worktree)
set -uo pipefail
repo=$1; branch=$2
main=$(git -C "$repo" rev-parse --abbrev-ref HEAD) || exit 1
if [ -n "$(git status --porcelain)" ]; then echo "Uncommitted changes: commit first (the pre-commit hook runs the checks)."; exit 1; fi
# A repo with a testlab ties every screen change to a roadmap card through a "Kaart: <uuid>" line.
proef=0
if [ -f e2e/project.ts ] || [ -f e2e/testlab.json ]; then
  proef=1
  missing=""
  for c in $(git rev-list --no-merges "$main..HEAD"); do
    msg=$(git log -1 --format=%B "$c")
    if ! printf '%s\\n' "$msg" | grep -Eqi '^Kaart:[[:space:]]*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[[:space:]]*$' &&
       ! printf '%s\\n' "$msg" | grep -Eqi '^Geen-kaart:[[:space:]]*[^[:space:]]+([[:space:]]+[^[:space:]]+){2,}'; then
      missing="$missing  $(git log -1 --format='%h %s' "$c")"$'\\n'
    fi
  done
  if [ -n "$missing" ]; then
    echo "Not landed: this repo has a testlab, and these commits lack a card line:"
    printf '%s' "$missing"
    echo "Every commit needs a line 'Kaart: <card uuid>' in its message, or 'Geen-kaart: <reason, a few words>'"
    echo "for work that changes nothing on a screen (test setup, docs). Ask the Manager for a card if you have none."
    echo "Last commit: git commit --amend. Several: git reset --soft $main and commit again with the line."
    exit 1
  fi
fi
# Demo first: in a repo with e2e/demo.ts (screens built from an approved demo) every commit that
# touches screens says where it stands: "Volgens-demo: <demo commit>" or "UI-afwijking: <screen> —
# <what> — <why>". Screens = .tsx/.css under app/ or components/, not app/api/ (as the testlab's
# isUiPad in demo.mjs). The testlab checks the same line after landing; here it never gets there.
if [ -f e2e/demo.ts ] && grep -Eq "naam: *['\\"]" e2e/demo.ts; then
  missing=""
  for c in $(git rev-list --no-merges "$main..HEAD"); do
    if git diff-tree --no-commit-id --name-only -r "$c" | grep -Ev '^app/api/' | grep -Eq '^(app|components)/.*\\.(tsx|css)$'; then
      msg=$(git log -1 --format=%B "$c")
      if ! printf '%s\n' "$msg" | grep -Eqi '^(Volgens-demo:[[:space:]]*[0-9a-f]{7,40}|UI-afwijking:[[:space:]]*[^[:space:]])'; then
        missing="$missing  $(git log -1 --format='%h %s' "$c")"$'\n'
      fi
    fi
  done
  if [ -n "$missing" ]; then
    echo "Not landed: these commits change screens without saying how they relate to the approved demo:"
    printf '%s' "$missing"
    echo "Add 'Volgens-demo: <demo commit>' (built as the demo shows) or 'UI-afwijking: <screen> — <what> — <why>'"
    echo "(screen = the name in e2e/demo.ts). Last commit: git commit --amend. Or an empty commit with the line: git commit --allow-empty."
    exit 1
  fi
fi
for attempt in 1 2 3; do
  before=$(git rev-parse HEAD)
  if ! git rebase -q "$main"; then
    git rebase --abort >/dev/null 2>&1
    echo "Rebase conflict with $main: resolve it only if it is clearly mechanical, otherwise report it."; exit 1
  fi
  if [ "$(git rev-parse HEAD)" != "$before" ] && [ -f package.json ] && grep -q '"typecheck"' package.json; then
    # The team's typecheck command when the machine has one (the same one the pre-commit hook runs).
    tc="$HOME/.config/omb-team/bin/omb-typecheck"
    if [ -x "$tc" ]; then "$tc" .; else npm run -s typecheck; fi
    if [ $? -ne 0 ]; then echo "The typecheck fails on top of the work merged meanwhile: fix it, commit, land again."; exit 1; fi
  fi
  # A repo with a testlab lands only what its proof run approves (the testlab's verdict: no new
  # failures, demo lines in order). When the test agent already wrote the card's spec on a
  # spec/<card> branch, the run tests this commit together with it and that combined commit lands,
  # so the card can go to Klaar at once. Testlab unreachable: land; main is tested after landing.
  if [ "$proef" = 1 ]; then
    proefcmd=\${OMB_PROEF_CMD:-"ssh -o BatchMode=yes -o ConnectTimeout=10 beast ~/testlab/proef.sh"}
    out=$($proefcmd --repo "$(basename "$repo")" "$(git rev-parse HEAD)" 2>&1); rc=$?
    printf '%s\n' "$out" | grep -v '^LANDMET '
    if [ $rc -eq 255 ]; then
      echo "Testlab not reachable: landing without a proof run (main is tested after landing)."
    elif [ $rc -ne 0 ]; then
      echo "Not landed: the proof run is not green (see above). Fix it, commit, land again."; exit 1
    else
      landmet=$(printf '%s\n' "$out" | awk '$1=="LANDMET"{s=$2} END{print s}')
      specs=$(printf '%s\n' "$out" | awk '$1=="LANDMET"{$1="";$2="";s=$0} END{print s}')
      if [ -n "$landmet" ] && git merge -q --ff-only "$landmet" 2>/dev/null; then
        echo "Landing together with the test agent's spec:$specs"
      fi
    fi
  fi
  if git -C "$repo" merge -q --ff-only "$branch" 2>/dev/null; then
    echo "Merged $(git rev-parse --short HEAD) into $main."
    for b in \${specs:-}; do git -C "$repo" branch -D "$b" >/dev/null 2>&1 || true; done
    # Publish right away, so the remote is never behind what landed. A refused push does not undo the landing.
    if up=$(git -C "$repo" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null); then
      if out=$(git -C "$repo" -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 push -q "\${up%%/*}" "$main" 2>&1); then
        echo "Pushed to $up."
      else
        echo "Push to $up failed (the landing itself is done): $out"
        echo "Report this to whoever gave you the task; do not force-push or work around it."
      fi
    fi
    exit 0
  fi
done
echo "$main kept moving while landing: run this again."; exit 1
`;

function landScriptPath(): string {
  return join(THREAD_WORKTREES_DIR, "land.sh");
}

function writeLandScript(): void {
  const path = landScriptPath();
  if (existsSync(path) && readFileSync(path, "utf8") === LAND_SCRIPT) return;
  writeFileSync(path, LAND_SCRIPT, { mode: 0o755 });
}

/** The command a thread runs in its worktree to land its committed work. */
export function threadWorktreeLandCommand(repo: string, threadId: string): string {
  return `bash "${landScriptPath()}" "${repo}" ${threadWorktreeBranch(threadId)}`;
}

/** Remove a thread's worktree when nothing in it would be lost: no
 * uncommitted changes and its branch already landed. Otherwise keep it and
 * say why, so unfinished work never disappears with a deleted thread. */
export function removeThreadWorktree(repo: string, botId: string, threadId: string): string | null {
  const path = threadWorktreePath(botId, threadId);
  if (!existsSync(path)) return null;
  const branch = threadWorktreeBranch(threadId);
  try {
    if (git(path, ["status", "--porcelain"])) return `kept ${path}: uncommitted changes`;
    git(repo, ["merge-base", "--is-ancestor", branch, projectBranch(repo)]);
  } catch {
    return `kept ${path}: ${branch} is not merged`;
  }
  git(repo, ["worktree", "remove", "--force", path]);
  git(repo, ["branch", "-D", branch]);
  return null;
}

/** How a thread in its own worktree lands its work. */
export function threadWorktreeSystemPrompt(repo: string, path: string, threadId: string): string {
  let main: string;
  try { main = projectBranch(repo); } catch { return ""; }
  const branch = threadWorktreeBranch(threadId);
  // The command below must work in every turn, also in a copy made before it existed.
  writeLandScript();
  return `\n\nYour own copy of the project. This conversation works in its own git worktree, ${path}, on branch ${branch}. The shared project folder is ${repo} (branch ${main}). Other conversations work in their own copies at the same time, so never edit files in the shared folder; it only receives merged work, and its dev preview shows only that.
- Starting an assignment: if \`git status\` is clean, run \`git rebase ${main}\` first so you build on the latest merged work. If package-lock.json changed, run \`npm ci\`.
- Finishing an assignment, in this order:
  1. Commit your work on ${branch}. The commit runs the checks your workspace rules call done (a pre-commit hook); fix what it reports and commit again.
  2. Land it in one command: \`${threadWorktreeLandCommand(repo, threadId)}\`. It rebases onto ${main}, typechecks again when that brought in other merged work, fast-forwards ${main} and prints the merged hash; if it reports a problem, fix that and run it again.
  Report the merged commit hash. Work is done only when it is merged.
- A rebase conflict with someone else's work: resolve it only when the fix is clearly mechanical; otherwise stop and report the conflict to whoever gave you the assignment.
- Never switch branches or commit in the shared folder.`;
}
