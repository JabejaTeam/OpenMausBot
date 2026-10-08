// Office (fork): every team's look (/api/team-looks, server/team-looks.ts),
// read once for the whole app and shared by the office and every bean avatar;
// kept current after each save. The office re-reads it when it opens.
import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/state/store";
import type { TeamLook } from "./office-team-looks";

export type TeamLookPatch = { color?: string | null; logo?: string | null; textColor?: string | null };

let looks: Record<string, TeamLook> = {};
let loaded = false;
const listeners = new Set<() => void>();

function publish(next: Record<string, TeamLook>) {
  looks = next;
  for (const listener of listeners) listener();
}

function load(refresh: boolean) {
  if (loaded && !refresh) return;
  loaded = true;
  api<{ teams: Record<string, TeamLook> }>("/api/team-looks").then((r) => publish(r?.teams ?? {})).catch(() => { loaded = false; });
}

export async function saveTeamLook(teamId: string, patch: TeamLookPatch) {
  const r = await api<{ teams: Record<string, TeamLook> }>(`/api/team-looks/${encodeURIComponent(teamId)}`, { method: "PUT", body: JSON.stringify(patch) });
  if (r?.teams) publish(r.teams);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** `refresh`: read the server again on mount (the office, to see others' edits). */
export function useTeamLooks({ refresh = false }: { refresh?: boolean } = {}) {
  useEffect(() => load(refresh), [refresh]);
  return { looks: useSyncExternalStore(subscribe, () => looks, () => looks), save: saveTeamLook };
}
