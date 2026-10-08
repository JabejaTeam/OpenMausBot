// Jabeja fork: where this person was last, per agent — the app's side of
// server/person-navigation.ts (the one record, shared by all their devices).
// The server already opens each agent on the conversation they last had
// open; this side answers which agent of a team they were on last, so a
// team opens there instead of always on its Manager.
import { useSyncExternalStore } from "react";

export interface Visit {
  threadId: string;
  at: number;
}

type Send = (path: string, init?: RequestInit) => Promise<unknown>;

const PATH = "/api/people/me/navigation";
const listeners = new Set<() => void>();
let visits: Readonly<Record<string, Visit>> = {};
let send: Send | null = null;

function changed(next: Record<string, Visit>) {
  visits = next;
  for (const listener of listeners) listener();
}

/** Start: read this person's visits from the server (the store calls this
 * once with its authenticated `api`). */
export function connectNavigationMemory(request: Send): void {
  send = request;
  void request(PATH)
    .then((answer) => {
      const loaded = (answer as { visits?: Record<string, Visit> } | null)?.visits;
      // keep any visit made while the request was on its way
      if (loaded && typeof loaded === "object") changed({ ...loaded, ...visits });
    })
    .catch(() => {});
}

/** This person is on this agent, in this conversation. `remote: false` when
 * the server already recorded it (switching or starting a conversation). */
export function noteVisit(botId: string, threadId: string, { remote = true } = {}): void {
  changed({ ...visits, [botId]: { threadId, at: Date.now() } });
  if (remote && send) void send(PATH, { method: "PUT", body: JSON.stringify({ botId, threadId }) }).catch(() => {});
}

/** The one of these agents this person was on last; undefined if none. */
export function lastVisited<B extends { id: string }>(bots: readonly B[], seen: Readonly<Record<string, Visit>> = visits): B | undefined {
  let best: B | undefined;
  let bestAt = -1;
  for (const bot of bots) {
    const at = seen[bot.id]?.at ?? -1;
    if (at > bestAt) {
      best = bot;
      bestAt = at;
    }
  }
  return bestAt >= 0 ? best : undefined;
}

export function useVisits(): Readonly<Record<string, Visit>> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => visits,
    () => visits,
  );
}
