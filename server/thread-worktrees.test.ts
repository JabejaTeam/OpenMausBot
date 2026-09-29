// Fork: a thread's own worktree starts from the project folder's branch with
// its local settings, lands by fast-forward, and is only removed once merged.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { ensureThreadWorktree, removeThreadWorktree, threadWorktreePath, threadWorktreeSystemPrompt } from "./thread-worktrees.ts";

const BOT = "bot-wt";
let repo: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).trim();

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "omb-wt-repo-"));
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, ".gitignore"), ".env.local\nnode_modules\n");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git(repo, "add", ".");
  git(repo, "commit", "-qm", "init");
  writeFileSync(join(repo, ".env.local"), "DATABASE_URL=dev\n");
  mkdirSync(join(repo, "node_modules", "dep"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "dep", "index.js"), "x");
});

afterEach(() => {
  for (const thread of ["t1", "t2"]) rmSync(threadWorktreePath(BOT, thread), { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

it("gives each thread its own copy on its own branch with the local settings", async () => {
  const one = await ensureThreadWorktree(repo, BOT, "t1");
  const two = await ensureThreadWorktree(repo, BOT, "t2");
  expect(one).not.toBe(two);
  expect(git(one, "rev-parse", "--abbrev-ref", "HEAD")).toBe("omb/t1");
  expect(readFileSync(join(one, ".env.local"), "utf8")).toBe("DATABASE_URL=dev\n");
  if (process.platform === "darwin") expect(existsSync(join(one, "node_modules", "dep", "index.js"))).toBe(true);
  // Idempotent: a later turn of the same thread gets the same copy back.
  expect(await ensureThreadWorktree(repo, BOT, "t1")).toBe(one);
  const prompt = threadWorktreeSystemPrompt(repo, one, "t1");
  expect(prompt).toContain(`git -C "${repo}" merge --ff-only omb/t1`);
  expect(prompt).toContain("git rebase main");
});

it("keeps an unmerged copy and removes it once it landed", async () => {
  const one = await ensureThreadWorktree(repo, BOT, "t1");
  writeFileSync(join(one, "a.txt"), "two\n");
  expect(removeThreadWorktree(repo, BOT, "t1")).toMatch(/uncommitted/);
  git(one, "commit", "-qam", "work");
  expect(removeThreadWorktree(repo, BOT, "t1")).toMatch(/not merged/);
  git(repo, "merge", "--ff-only", "omb/t1");
  expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("two\n");
  expect(removeThreadWorktree(repo, BOT, "t1")).toBeNull();
  expect(existsSync(one)).toBe(false);
  expect(git(repo, "branch", "--list", "omb/t1")).toBe("");
});
