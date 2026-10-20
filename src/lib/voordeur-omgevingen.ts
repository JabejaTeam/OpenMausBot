// Jabeja fork: switching between OMB environments behind the shared front door
// (omb-voordeur, bots.jabeja.be). The door answers /__voordeur/omgevingen with
// the environments whose sign-in list holds the signed-in person's email; this
// server itself does not know them. Without a door in front, this server
// answers that path with its own page (HTML), so the list stays empty and the
// Settings item stays hidden — no failed request, nothing in the console.
import { useEffect, useState } from "react";

export type Omgeving = { naam: string; titel: string; actief: boolean; ingelogd: boolean; basis?: string };

const isOmgeving = (value: unknown): value is Omgeving => {
  const o = value as Partial<Omgeving> | null;
  return Boolean(o) && typeof o?.naam === "string" && typeof o.titel === "string" && typeof o.actief === "boolean" && typeof o.ingelogd === "boolean";
};

/** The environments this person may switch between; [] when there is no front door or no answer. */
export async function fetchOmgevingen(fetchImpl: typeof fetch = fetch): Promise<Omgeving[]> {
  try {
    const res = await fetchImpl("/__voordeur/omgevingen", { credentials: "same-origin", headers: { accept: "application/json" } });
    if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) return [];
    const body = (await res.json()) as { omgevingen?: unknown };
    return Array.isArray(body?.omgevingen) ? body.omgevingen.filter(isOmgeving) : [];
  } catch {
    return [];
  }
}

/** Signed in on one environment: be signed in on every other one this
 * person's email is listed in too (the door asks each for a session).
 * Answers the list as it is afterwards; [] when there is no door. */
export async function aanmeldenOveral(fetchImpl: typeof fetch = fetch): Promise<Omgeving[]> {
  try {
    const res = await fetchImpl("/__voordeur/overal", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: "{}" });
    if (!res.ok || !/json/i.test(res.headers.get("content-type") ?? "")) return [];
    const body = (await res.json()) as { omgevingen?: unknown };
    return Array.isArray(body?.omgevingen) ? body.omgevingen.filter(isOmgeving) : [];
  } catch {
    return [];
  }
}

/** Whether there is anything to switch between. */
export function canSwitchOmgeving(list: readonly Omgeving[]): boolean {
  return list.length > 1;
}

/** Ask the door to switch; it sets its router cookie and says where to go
 * ("/" when signed in there, else the sign-in page with the email filled in). */
export async function wisselOmgeving(naam: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl("/__voordeur/wissel", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ naam }),
  });
  const body = (await res.json().catch(() => null)) as { naar?: unknown } | null;
  if (!res.ok || typeof body?.naar !== "string" || !body.naar.startsWith("/")) throw new Error(`switch failed (${res.status})`);
  return body.naar;
}

let pending: Promise<Omgeving[]> | null = null;
let known: Omgeving[] = [];

/** Asked once per page load (a switch reloads the page), shared by Settings and the profile row. */
export function useOmgevingen(): Omgeving[] {
  const [list, setList] = useState<Omgeving[]>(known);
  useEffect(() => {
    let alive = true;
    pending ??= fetchOmgevingen().then((value) => (known = value));
    void pending.then((value) => { if (alive) setList(value); });
    return () => { alive = false; };
  }, []);
  return list;
}
