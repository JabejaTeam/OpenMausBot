// Jabeja fork: whose a conversation is, on a workspace several people share.
//
// The single rule (SSOT) for "may this person see and write in this thread":
// every conversation is private. It belongs to the person it was opened for
// (server/thread-starters.ts: whoever started it, or — for work a bot opened
// on someone's request — the person that request came from); a thread nobody
// was recorded for belongs to the install owner. Besides its person, only
// the people they explicitly shared it with (ThreadShares) and admins see it.
// There is no team-wide default and no switch: on such a workspace this rule
// is always on (server/index.ts privateThreads()). The owner on this machine
// and local services (loopback) are not people and keep seeing everything.
//
// Admins see every conversation (role "team"), but that is oversight, not
// participation: what flows from one conversation into another (a bot's
// recent-work brief, recall, session_search, list_threads) follows
// `threadFeeds`, which ignores the admin exception.
//
// server/bot-visibility.ts applies the rule to every route, list and live
// frame; server/index.ts only wires the records in.
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";

const KEY = /^p_[\w-]{22}$/;
const THREAD = /^[\w-]{1,128}$/;
export const MAX_THREAD_SHARES = 50;

/** How a person reaches a thread: their own, one shared with them, or —
 * admins only — someone else's. */
export type ThreadRole = "own" | "shared" | "team";

export interface ThreadAccessRecords {
  /** Who the thread was opened for, when recorded. */
  starter(threadId: string): string | undefined;
  /** Who it was shared with. */
  shares(threadId: string): readonly string[];
  /** The install owner: owns every thread nobody was recorded for. */
  owner(): string | undefined;
}

export function threadOwnerPerson(threadId: string, records: ThreadAccessRecords): string | undefined {
  return records.starter(threadId) ?? records.owner();
}

/** `admin`: the person signs in as an admin, so they see everyone's. */
export function threadRole(person: string | undefined, threadId: string, records: ThreadAccessRecords, admin = false): ThreadRole | undefined {
  if (!person) return undefined;
  if (threadOwnerPerson(threadId, records) === person) return "own";
  if (records.shares(threadId).includes(person)) return "shared";
  return admin ? "team" : undefined;
}

/** Everyone a thread is for: its person and whom they shared it with
 * (admins aside). */
export function threadAudience(threadId: string, records: ThreadAccessRecords): string[] {
  const owner = threadOwnerPerson(threadId, records);
  return [...new Set([...(owner ? [owner] : []), ...records.shares(threadId)])];
}

/** Whether what was said in `source` may flow into `into` (a brief, recall,
 * a search hit, a thread title): only when everyone `into` is for may
 * already open `source` as their own or as shared with them. */
export function threadFeeds(source: string, into: string, records: ThreadAccessRecords): boolean {
  if (source === into) return true;
  const audience = threadAudience(into, records);
  return audience.length > 0 && audience.every((person) => {
    const role = threadRole(person, source, records);
    return role === "own" || role === "shared";
  });
}

/** The conversation a person lands in when they open a bot or room: the one
 * of theirs (own or shared) that moved last. Hidden routine runs are not
 * conversations. Undefined when they have none yet. */
export function latestThreadFor<T extends { threadId: string; updatedAt?: number; createdAt?: number; routineRunId?: string }>(
  tasks: readonly T[],
  open: (threadId: string) => boolean,
): T | undefined {
  let best: T | undefined;
  for (const task of tasks) {
    if (task.routineRunId || !open(task.threadId)) continue;
    const at = task.updatedAt ?? task.createdAt ?? 0;
    if (!best || at > (best.updatedAt ?? best.createdAt ?? 0)) best = task;
  }
  return best;
}

/** Thread → the people its owner shared it with. One small server-private
 * file (<data>/thread-shares.json, 0600). */
export class ThreadShares {
  private readonly shares = new Map<string, string[]>();
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return; // absent or unreadable: nothing is shared
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const [threadId, people] of Object.entries(raw)) {
      if (!THREAD.test(threadId) || !Array.isArray(people)) continue;
      const kept = [...new Set(people.filter((person): person is string => typeof person === "string" && KEY.test(person)))];
      if (kept.length) this.shares.set(threadId, kept.slice(0, MAX_THREAD_SHARES));
    }
  }

  get(threadId: string): readonly string[] {
    return this.shares.get(threadId) ?? [];
  }

  /** Replace who a thread is shared with. False for an invalid list. */
  set(threadId: string, people: readonly string[]): boolean {
    if (!THREAD.test(threadId) || people.length > MAX_THREAD_SHARES || people.some((person) => !KEY.test(person))) return false;
    const kept = [...new Set(people)];
    if (kept.length) this.shares.set(threadId, kept);
    else this.shares.delete(threadId);
    writeFileAtomic(this.file, JSON.stringify(Object.fromEntries(this.shares)) + "\n", { mode: 0o600 });
    return true;
  }
}
