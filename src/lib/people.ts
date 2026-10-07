// Who sent a person's message, on a workspace several people share. Every
// user message a signed-in person sends carries `sender` (their people key
// and, for older rows, their email as the name); this names everyone but
// the viewer themselves, so a transcript shows who asked what.
import { useEffect, useSyncExternalStore } from "react";

import { api, type Message } from "@/state/store";
import { peerLine } from "./peer-message";

let me: string | undefined;
let names: Record<string, string> = {};
let hiddenBots: ReadonlySet<string> = new Set();
let version = 0;
let requested = false;
const listeners = new Set<() => void>();

function loadPeople(): void {
  if (requested) return;
  requested = true;
  void Promise.allSettled([
    api<{ id?: string; hiddenBots?: string[] }>("/api/people/me"),
    api<{ names?: Record<string, string> }>("/api/people/names"),
  ]).then(([mine, all]) => {
    if (mine.status === "fulfilled" && typeof mine.value?.id === "string") me = mine.value.id;
    if (mine.status === "fulfilled" && Array.isArray(mine.value?.hiddenBots)) hiddenBots = new Set(mine.value.hiddenBots);
    if (all.status === "fulfilled" && all.value?.names && typeof all.value.names === "object") names = all.value.names;
    changed();
  });
}

function changed(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/** Re-render once the people are known. Fork: `load` false only listens
 * (a thread list that shows no teammate's conversation asks nothing). */
export function usePeople(load = true): void {
  useEffect(() => { if (load) loadPeople(); }, [load]);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => version,
    () => version,
  );
}

/** The name of whoever sent this person's message, when that is not the
 * viewer. Undefined for the viewer's own messages, for a bot's relayed
 * line, and for rows that carry no sender (the owner's own, and older ones). */
export function otherSenderName(message: Message): string | undefined {
  if (message.role !== "user" || peerLine(message)) return undefined;
  const sender = message.sender;
  if (!sender?.id || sender.id === me) return undefined;
  return names[sender.id] ?? sender.name;
}

/** Fork: a teammate's name for a people key (their profile name), when known. */
export function personName(key: string | undefined): string | undefined {
  return key ? names[key] : undefined;
}

/** Bots the viewer keeps out of their own sidebar (Team map → eye). Empty
 * without a signed-in person. Call usePeople() to re-render when it loads. */
export function hiddenBotsForMe(): ReadonlySet<string> {
  return hiddenBots;
}

/** Whether this viewer can hide bots: only a signed-in person has a list. */
export function canHideBots(): boolean {
  return me !== undefined;
}

/** Hide or show a bot in the viewer's own lists; saved on their profile so
 * the web app and phone agree. Rolls back when the save fails. */
export async function setBotHiddenForMe(botId: string, hidden: boolean): Promise<void> {
  const before = hiddenBots;
  const next = new Set(before);
  if (hidden) next.add(botId); else next.delete(botId);
  hiddenBots = next;
  changed();
  try {
    const saved = await api<{ hiddenBots?: string[] }>("/api/people/me", { method: "PUT", body: JSON.stringify({ hiddenBots: [...next] }) });
    if (Array.isArray(saved?.hiddenBots)) hiddenBots = new Set(saved.hiddenBots);
  } catch (error) {
    hiddenBots = before;
    throw error;
  } finally {
    changed();
  }
}

/** Test seam. */
export function setPeopleForTest(next: { me?: string; names?: Record<string, string>; hiddenBots?: string[] }): void {
  me = next.me;
  names = next.names ?? {};
  hiddenBots = new Set(next.hiddenBots ?? []);
  requested = true;
}
