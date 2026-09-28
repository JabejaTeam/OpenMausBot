// Who sent a person's message, on a workspace several people share. Every
// user message a signed-in person sends carries `sender` (their people key
// and, for older rows, their email as the name); this names everyone but
// the viewer themselves, so a transcript shows who asked what.
import { useEffect, useSyncExternalStore } from "react";

import { api, type Message } from "@/state/store";
import { peerLine } from "./peer-message";

let me: string | undefined;
let names: Record<string, string> = {};
let version = 0;
let requested = false;
const listeners = new Set<() => void>();

function loadPeople(): void {
  if (requested) return;
  requested = true;
  void Promise.allSettled([
    api<{ id?: string }>("/api/people/me"),
    api<{ names?: Record<string, string> }>("/api/people/names"),
  ]).then(([mine, all]) => {
    if (mine.status === "fulfilled" && typeof mine.value?.id === "string") me = mine.value.id;
    if (all.status === "fulfilled" && all.value?.names && typeof all.value.names === "object") names = all.value.names;
    version += 1;
    for (const listener of listeners) listener();
  });
}

/** Re-render once the people are known. */
export function usePeople(): void {
  useEffect(loadPeople, []);
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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

/** Test seam. */
export function setPeopleForTest(next: { me?: string; names?: Record<string, string> }): void {
  me = next.me;
  names = next.names ?? {};
  requested = true;
}
