// Jabeja fork: whose a conversation is, on a workspace several people share.
//
// The single rule (SSOT) for "may this person see and write in this thread":
// a thread belongs to the person it was opened for (server/thread-starters.ts).
// Everyone on the workspace sees and writes in it (the team channel), unless
// its person marked it private (this file's PrivateThreads): then only they
// and whom they shared it with (ThreadShares) do. A thread nobody was
// recorded for belongs to the install owner. Admins get no exception: private
// means private. The owner on this machine and local services (loopback) are
// not people and keep seeing everything.
//
// server/bot-visibility.ts applies the rule to every route, list and live
// frame; server/index.ts only wires the records in.
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";

const KEY = /^p_[\w-]{22}$/;
const THREAD = /^[\w-]{1,128}$/;
export const MAX_THREAD_SHARES = 50;

/** How a person reaches a thread: their own, a private one shared with them,
 * or a teammate's that is not private. */
export type ThreadRole = "own" | "shared" | "team";

export interface ThreadAccessRecords {
  /** Who the thread was opened for, when recorded. */
  starter(threadId: string): string | undefined;
  /** Who it was shared with. */
  shares(threadId: string): readonly string[];
  /** The install owner: owns every thread nobody was recorded for. */
  owner(): string | undefined;
  /** Its person marked it private. */
  isPrivate(threadId: string): boolean;
}

export function threadOwnerPerson(threadId: string, records: ThreadAccessRecords): string | undefined {
  return records.starter(threadId) ?? records.owner();
}

export function threadRole(person: string | undefined, threadId: string, records: ThreadAccessRecords): ThreadRole | undefined {
  if (!person) return undefined;
  if (threadOwnerPerson(threadId, records) === person) return "own";
  if (!records.isPrivate(threadId)) return "team";
  return records.shares(threadId).includes(person) ? "shared" : undefined;
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

/** The threads their person marked private. One small server-private file
 * (<data>/thread-private.json, 0600): a list of thread ids. */
export class PrivateThreads {
  private readonly ids = new Set<string>();
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return; // absent or unreadable: nothing is private
    }
    if (!Array.isArray(raw)) return;
    for (const id of raw) if (typeof id === "string" && THREAD.test(id)) this.ids.add(id);
  }

  has(threadId: string): boolean {
    return this.ids.has(threadId);
  }

  /** False for an invalid thread id. */
  set(threadId: string, value: boolean): boolean {
    if (!THREAD.test(threadId)) return false;
    if (value) this.ids.add(threadId);
    else this.ids.delete(threadId);
    writeFileAtomic(this.file, JSON.stringify([...this.ids]) + "\n", { mode: 0o600 });
    return true;
  }
}
