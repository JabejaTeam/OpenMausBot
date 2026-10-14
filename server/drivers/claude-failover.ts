// Fork: a second Claude subscription takes over when the first one's usage
// limit refuses a turn. The second account is a long-lived token
// (`claude setup-token`, signed in as that account) in
// <DATA_DIR>/claude-fallback-token. Only an account without its own config
// directory or token falls over: the token rides in CLAUDE_CODE_OAUTH_TOKEN,
// which the CLI prefers over its stored login, so the config directory — and
// with it every session a turn resumes — stays the same.
//
// The first account is refused until the window the refusal named reopens
// (an hour when it names none); until then every new launch uses the second.
// A warm process keeps the account it was launched with, but the account is
// part of its spawn contract, so its next turn relaunches on the right one.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import type { ClaudeLimit } from "./claude.ts";

export const FALLBACK_TOKEN_FILE = join(DATA_DIR, "claude-fallback-token");
const UNNAMED_WINDOW_MS = 60 * 60_000;

let primaryRefusedUntil = 0;

/** The second account's token, read per launch so adding or removing the
 * file needs no restart; null without one. */
export function fallbackToken(file = FALLBACK_TOKEN_FILE): string | null {
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** This account may fall over: it is the machine's default login. */
export function mayFailOver(configDir: string | undefined, instanceEnvironment: NodeJS.ProcessEnv): boolean {
  return !configDir?.trim() && !instanceEnvironment.CLAUDE_CODE_OAUTH_TOKEN && fallbackToken() !== null;
}

/** The first account's usage limit refused a turn. */
export function notePrimaryRefused(limit: ClaudeLimit | null, now = Date.now()): void {
  const until = limit?.resetsAt && limit.resetsAt * 1000 > now ? limit.resetsAt * 1000 : now + UNNAMED_WINDOW_MS;
  primaryRefusedUntil = Math.max(primaryRefusedUntil, until);
  console.error(`claude: usage limit on the main account — the second account takes over until ${new Date(primaryRefusedUntil).toISOString()}`);
}

/** Put the second account in a launch's environment while the first is
 * refused. Returns whether the launch runs on the second account. */
export function applyFailover(
  env: NodeJS.ProcessEnv,
  configDir: string | undefined,
  instanceEnvironment: NodeJS.ProcessEnv,
  now = Date.now(),
): boolean {
  if (now >= primaryRefusedUntil || !mayFailOver(configDir, instanceEnvironment)) return false;
  env.CLAUDE_CODE_OAUTH_TOKEN = fallbackToken()!;
  return true;
}

/** Tests only. */
export function resetFailover(): void {
  primaryRefusedUntil = 0;
}
