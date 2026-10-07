// Jabeja fork: conversations per person (server/thread-access.ts). Every
// thread a bot sends carries `access` (own / shared / team) and `person`
// (whose channel it is in). The thread column shows one channel at a time:
// "mine" (the default), "team" (everything the viewer may open) or one
// teammate's. The choice is this device's, kept across reloads.
import { useSyncExternalStore } from "react";

import type { Task } from "@/state/store";

export type ThreadChannel = "mine" | "team" | `person:${string}`;

const KEY = "omb-thread-channel";
const listeners = new Set<() => void>();
let channel: ThreadChannel = read();

function read(): ThreadChannel {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "team" || saved?.startsWith("person:")) return saved as ThreadChannel;
  } catch {
    // no storage (private window, tests): the default
  }
  return "mine";
}

export function setThreadChannel(next: ThreadChannel): void {
  channel = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // kept for this session only
  }
  for (const listener of listeners) listener();
}

export function useThreadChannel(): ThreadChannel {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => channel,
    () => channel,
  );
}

/** Whether a thread is in a channel. A thread without `access` (a server
 * that does not split conversations per person) is everyone's. */
export function inThreadChannel(task: Pick<Task, "access" | "person">, which: ThreadChannel): boolean {
  if (!task.access || which === "team") return true;
  if (which === "mine") return task.access === "own";
  return task.person === which.slice("person:".length);
}

/** Threads this device chose to open (a click, a link, a notification).
 * Opening a bot lands in the viewer's own latest conversation; when they
 * have none, the server keeps the bot's current one on screen without its
 * transcript, and the composer must not write into a teammate's thread
 * nobody here picked. */
const chosen = new Set<string>();
export function noteThreadChosen(threadId: string): void {
  chosen.add(threadId);
}
export function threadChosen(threadId: string): boolean {
  return chosen.has(threadId);
}
