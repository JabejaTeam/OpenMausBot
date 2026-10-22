// Fork: a thread's own worktree starts from the project folder's branch with
// its local settings, lands by fast-forward, and is only removed once merged.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";

import { ensureThreadWorktree, removeThreadWorktree, threadWorktreeLandCommand, threadWorktreePath, threadWorktreeSystemPrompt } from "./thread-worktrees.ts";

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
  // Every platform: the copy can typecheck without a fresh install.
  expect(existsSync(join(one, "node_modules", "dep", "index.js"))).toBe(true);
  // Idempotent: a later turn of the same thread gets the same copy back.
  expect(await ensureThreadWorktree(repo, BOT, "t1")).toBe(one);
  const prompt = threadWorktreeSystemPrompt(repo, one, "t1");
  expect(prompt).toContain(threadWorktreeLandCommand(repo, "t1"));
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

/** Runs the land command the prompt gives the agent; returns its exit status and output. */
function land(cwd: string, thread: string): { status: number; out: string } {
  const [cmd, ...args] = ["bash", "-c", threadWorktreeLandCommand(repo, thread)];
  try {
    return { status: 0, out: execFileSync(cmd!, args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }) };
  } catch (error: any) {
    return { status: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

it("lands committed work in one command, rebasing onto work merged meanwhile", async () => {
  const one = await ensureThreadWorktree(repo, BOT, "t1");
  writeFileSync(join(one, "a.txt"), "two\n");
  git(one, "commit", "-qam", "work");
  writeFileSync(join(repo, "b.txt"), "other\n");
  git(repo, "add", "b.txt");
  git(repo, "commit", "-qm", "merged meanwhile");
  const result = land(one, "t1");
  expect(result.status, result.out).toBe(0);
  expect(result.out).toContain(`Merged ${git(one, "rev-parse", "--short", "HEAD")}`);
  expect(git(repo, "rev-parse", "HEAD")).toBe(git(one, "rev-parse", "HEAD"));
  expect(readFileSync(join(repo, "a.txt"), "utf8")).toBe("two\n");
  expect(readFileSync(join(repo, "b.txt"), "utf8")).toBe("other\n");
});

it("refuses to land uncommitted work, or work whose typecheck fails on top of new merges", async () => {
  const one = await ensureThreadWorktree(repo, BOT, "t1");
  writeFileSync(join(one, "a.txt"), "two\n");
  expect(land(one, "t1")).toMatchObject({ status: 1, out: expect.stringContaining("commit first") });
  git(one, "commit", "-qam", "work");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ scripts: { typecheck: "echo broken-types >&2; exit 1" } }));
  git(repo, "add", "package.json");
  git(repo, "commit", "-qm", "merged meanwhile, breaks types");
  const before = git(repo, "rev-parse", "HEAD");
  const result = land(one, "t1");
  expect(result.status).toBe(1);
  expect(result.out).toContain("typecheck");
  expect(git(repo, "rev-parse", "HEAD")).toBe(before);
});

it("pushes what landed to the branch's upstream, and a refused push leaves the landing done", async () => {
  const remote = mkdtempSync(join(tmpdir(), "omb-wt-remote-"));
  try {
    git(remote, "init", "-q", "--bare", "-b", "main");
    git(repo, "remote", "add", "origin", remote);
    git(repo, "push", "-q", "-u", "origin", "main");
    const one = await ensureThreadWorktree(repo, BOT, "t1");
    writeFileSync(join(one, "a.txt"), "two\n");
    git(one, "commit", "-qam", "work");
    const result = land(one, "t1");
    expect(result).toMatchObject({ status: 0, out: expect.stringContaining("Pushed to origin/main") });
    expect(git(remote, "rev-parse", "main")).toBe(git(repo, "rev-parse", "HEAD"));

    // Someone else moved the remote: the push is refused, the local landing still counts.
    const other = mkdtempSync(join(tmpdir(), "omb-wt-other-"));
    git(other, "clone", "-q", remote, ".");
    writeFileSync(join(other, "c.txt"), "x\n");
    git(other, "add", "c.txt");
    git(other, "commit", "-qm", "elsewhere");
    git(other, "push", "-q", "origin", "main");
    rmSync(other, { recursive: true, force: true });
    writeFileSync(join(one, "a.txt"), "three\n");
    git(one, "commit", "-qam", "more work");
    const refused = land(one, "t1");
    expect(refused).toMatchObject({ status: 0, out: expect.stringContaining("Push to origin/main failed") });
    expect(git(repo, "rev-parse", "HEAD")).toBe(git(one, "rev-parse", "HEAD"));
  } finally {
    rmSync(remote, { recursive: true, force: true });
  }
});

it("in a repo with a testlab, lands only commits that name their card", async () => {
  mkdirSync(join(repo, "e2e"));
  writeFileSync(join(repo, "e2e", "project.ts"), "export {};\n");
  git(repo, "add", "e2e");
  git(repo, "commit", "-qm", "testlab");
  const one = await ensureThreadWorktree(repo, BOT, "t1");
  writeFileSync(join(one, "a.txt"), "two\n");
  git(one, "commit", "-qam", "work");
  const before = git(repo, "rev-parse", "HEAD");
  const refused = land(one, "t1");
  expect(refused.status).toBe(1);
  expect(refused.out).toContain(`${git(one, "rev-parse", "--short", "HEAD")} work`);
  expect(refused.out).toContain("Ask the Manager for a card");
  expect(git(repo, "rev-parse", "HEAD")).toBe(before);

  // A one-word reason is not a reason.
  git(one, "commit", "-q", "--amend", "-m", "work\n\nGeen-kaart: docs");
  expect(land(one, "t1").status).toBe(1);
  git(one, "commit", "-q", "--amend", "-m", "work\n\nKaart: 0a1b2c3d-1111-4222-8333-444455556666");
  expect(land(one, "t1")).toMatchObject({ status: 0, out: expect.stringContaining("Merged") });

  writeFileSync(join(one, "a.txt"), "three\n");
  git(one, "commit", "-qam", "test setup\n\nGeen-kaart: only the e2e setup changes");
  expect(land(one, "t1")).toMatchObject({ status: 0, out: expect.stringContaining("Merged") });
});

it("in a repo built from a demo, lands screen commits only with a demo line", async () => {
  mkdirSync(join(repo, "e2e"));
  writeFileSync(join(repo, "e2e", "demo.ts"), "export const DEMO_SCHERMEN = [{ naam: 'aankoop', demo: '/aankoop/', app: '/aankoop' }];\n");
  git(repo, "add", "e2e");
  git(repo, "commit", "-qm", "demo");
  const one = await ensureThreadWorktree(repo, BOT, "t1");
  mkdirSync(join(one, "app", "aankoop"), { recursive: true });
  writeFileSync(join(one, "app", "aankoop", "page.tsx"), "export default 1;\n");
  git(one, "add", "app");
  git(one, "commit", "-qm", "screen");
  const before = git(repo, "rev-parse", "HEAD");
  const refused = land(one, "t1");
  expect(refused.status).toBe(1);
  expect(refused.out).toContain(`${git(one, "rev-parse", "--short", "HEAD")} screen`);
  expect(refused.out).toContain("Volgens-demo");
  expect(git(repo, "rev-parse", "HEAD")).toBe(before);

  git(one, "commit", "-q", "--amend", "-m", "screen\n\nUI-afwijking: aankoop — knop rechts — de server vraagt het");
  expect(land(one, "t1")).toMatchObject({ status: 0, out: expect.stringContaining("Merged") });

  // Not a screen (an API route, a lib file): no demo line needed.
  mkdirSync(join(one, "app", "api", "x"), { recursive: true });
  writeFileSync(join(one, "app", "api", "x", "route.tsx"), "export const GET = 1;\n");
  writeFileSync(join(one, "lib.ts"), "export const x = 1;\n");
  git(one, "add", "-A");
  git(one, "commit", "-qm", "backend");
  expect(land(one, "t1")).toMatchObject({ status: 0, out: expect.stringContaining("Merged") });

  writeFileSync(join(one, "app", "aankoop", "page.tsx"), "export default 2;\n");
  git(one, "commit", "-qam", "screen again\n\nVolgens-demo: 94d595f");
  expect(land(one, "t1")).toMatchObject({ status: 0, out: expect.stringContaining("Merged") });
});

it("in a repo with a testlab, lands only after a green proof run, together with a waiting spec", async () => {
  mkdirSync(join(repo, "e2e"));
  writeFileSync(join(repo, "e2e", "project.ts"), "export {};\n");
  git(repo, "add", "e2e");
  git(repo, "commit", "-qm", "testlab");
  const id = "0a1b2c3d-1111-4222-8333-444455556666";
  // The test agent's spec, waiting on spec/<card>.
  git(repo, "branch", `spec/${id}`);
  const spec = await ensureThreadWorktree(repo, BOT, "t2");
  git(spec, "switch", "-q", `spec/${id}`);
  writeFileSync(join(spec, "e2e", "kaart.spec.ts"), "test\n");
  git(spec, "add", "e2e");
  git(spec, "commit", "-qm", `spec\n\nKaart: ${id}`);
  git(spec, "switch", "-q", "--detach");
  const one = await ensureThreadWorktree(repo, BOT, "t1");
  writeFileSync(join(one, "a.txt"), "two\n");
  git(one, "commit", "-qam", `work\n\nKaart: ${id}`);
  // A fake testlab: red first, then green with the combined commit (merge of HEAD and the spec).
  const fake = join(repo, "..", "fake-proef.sh");
  writeFileSync(fake, `#!/usr/bin/env bash
sha=$3
if [ -f "${repo}.rood" ]; then echo "Proefrun: NIEUWE fouten"; exit 1; fi
tree=$(git -C "${repo}" merge-tree --write-tree "$sha" spec/${id} | head -1)
c=$(git -C "${repo}" commit-tree "$tree" -p "$sha" -p spec/${id} -m proef)
echo "LANDMET 0000000000000000000000000000000000000000 spec/${id}"
echo "Proefrun groen: mag landen."
echo "LANDMET $c spec/${id}"
`, { mode: 0o755 });
  writeFileSync(`${repo}.rood`, "");
  threadWorktreeSystemPrompt(repo, one, "t1");
  const env = { ...process.env, OMB_PROEF_CMD: fake };
  const run = () => {
    try {
      return { status: 0, out: execFileSync("bash", ["-c", threadWorktreeLandCommand(repo, "t1")], { cwd: one, encoding: "utf8", env: { ...env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }) };
    } catch (error: any) {
      return { status: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
    }
  };
  const before = git(repo, "rev-parse", "HEAD");
  const rood = run();
  expect(rood.out).toContain("proof run is not green");
  expect(rood.status).toBe(1);
  expect(git(repo, "rev-parse", "HEAD")).toBe(before);
  rmSync(`${repo}.rood`);
  expect(run()).toMatchObject({ status: 0, out: expect.stringContaining("together with the test agent's spec") });
  expect(git(repo, "ls-tree", "-r", "--name-only", "HEAD")).toContain("e2e/kaart.spec.ts");
  expect(git(repo, "branch", "--list", `spec/${id}`)).toBe("");
});

it("hands out a land command that works in a copy made before the command existed", async () => {
  const one = await ensureThreadWorktree(repo, BOT, "t1");
  const script = threadWorktreeLandCommand(repo, "t1").match(/bash "([^"]+)"/)![1]!;
  rmSync(script, { force: true });
  threadWorktreeSystemPrompt(repo, one, "t1");
  expect(existsSync(script)).toBe(true);
});
