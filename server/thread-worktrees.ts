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
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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

/** Create (once) the thread's worktree and return its path. Untracked .env*
 * files at the repo root are copied (they hold the local settings a checkout
 * lacks); node_modules at the root and one level down are cloned
 * copy-on-write on macOS, so the copy can build without a fresh install. */
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
  if (process.platform === "darwin") {
    const dirs = ["", ...readdirSync(repo).filter((name) => !name.startsWith(".") && name !== "node_modules" &&
      statSync(join(repo, name)).isDirectory() && existsSync(join(path, name)))];
    for (const dir of dirs) {
      const source = join(repo, dir, "node_modules");
      const target = join(path, dir, "node_modules");
      if (existsSync(source) && !existsSync(target)) await run("cp", ["-cR", source, target]);
    }
  }
  return path;
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
  return `\n\nYour own copy of the project. This conversation works in its own git worktree, ${path}, on branch ${branch}. The shared project folder is ${repo} (branch ${main}). Other conversations work in their own copies at the same time, so never edit files in the shared folder; it only receives merged work, and its dev preview shows only that.
- Starting an assignment: if \`git status\` is clean, run \`git rebase ${main}\` first so you build on the latest merged work. If package-lock.json changed, run \`npm ci\`.
- Finishing an assignment, in this order:
  1. Commit your work on ${branch}. The commit runs the checks your workspace rules call done (a pre-commit hook); fix what it reports and commit again.
  2. \`git rebase ${main}\`. If that brought in new commits, run those checks again.
  3. \`git -C "${repo}" merge --ff-only ${branch}\`. If it refuses because ${main} moved on, repeat from step 2.
  Report the merged commit hash. Work is done only when it is merged.
- A rebase conflict with someone else's work: resolve it only when the fix is clearly mechanical; otherwise stop and report the conflict to whoever gave you the assignment.
- Never switch branches or commit in the shared folder.`;
}
