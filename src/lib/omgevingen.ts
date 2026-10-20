// Jabeja fork: one window shows every OpenMausBot this person is signed in to
// behind the voordeur (bots.jabeja.be): Ripal, Jabeja, Private Equity, … side
// by side in the sidebar, each with its own store and live stream, nothing
// reloaded when you go from one to the other. The door routes a request by
// its path: /o/<naam>/api/... goes to <naam> with that instance's own
// session. This module is the one place that decides which instance a
// request is for:
//   1. an explicit name (a store asking its own server),
//   2. else the instance that owns the bot, room or conversation the request
//      names (ids are UUIDs, never shared between instances),
//   3. else the active instance (the one whose bot is open).
// Without a door, or signed in to one instance that is also the door's
// current one, nothing here changes a single request.
import { useSyncExternalStore } from "react";

import { aanmeldenOveral, fetchOmgevingen } from "./voordeur-omgevingen";

export interface OpenOmgeving {
  naam: string;
  titel: string;
}

const ACTIEF_KEY = "omb-omgeving-actief";
const ID_PATH = /^\/api\/(?:bots|groups|threads|tasks|rooms|attachments)\/([\w-]+)/;

let open: readonly OpenOmgeving[] = [];
let actief: string | null = null;
const owners = new Map<string, string>();
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

function remembered(): string | null {
  try {
    return globalThis.localStorage?.getItem(ACTIEF_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Once per page, before the app renders: which instances to open. Signed in
 * on one only, the door signs this person in on the others first. */
export async function startOmgevingen(fetchImpl: typeof fetch = fetch, { install = true } = {}): Promise<void> {
  let list = await fetchOmgevingen(fetchImpl);
  if (list.length > 1 && list.some((o) => !o.ingelogd)) {
    const after = await aanmeldenOveral(fetchImpl);
    if (after.length) list = after;
  }
  const signedIn = list.filter((o) => o.ingelogd);
  // One instance, and it is where the door sends unprefixed requests anyway: nothing to do.
  if (signedIn.length === 0 || (signedIn.length === 1 && signedIn[0].actief)) return;
  // Where the door put this person first, the others in the door's order.
  const first = signedIn.find((o) => o.actief) ?? signedIn[0];
  open = [first, ...signedIn.filter((o) => o !== first)].map(({ naam, titel }) => ({ naam, titel }));
  const last = remembered();
  actief = open.some((o) => o.naam === last) ? last : first.naam;
  if (install) installFetch();
}

/** Several instances in this window (the sidebar groups by instance). */
export function samen(): boolean {
  return open.length > 1;
}

export function openOmgevingen(): readonly OpenOmgeving[] {
  return open;
}

export function actieveOmgeving(): string | null {
  return actief;
}

/** The instance whose bot is open. A store of another instance stays live. */
export function setActieveOmgeving(naam: string): void {
  if (naam === actief || !open.some((o) => o.naam === naam)) return;
  actief = naam;
  try {
    globalThis.localStorage?.setItem(ACTIEF_KEY, naam);
  } catch {
    // private windows may refuse storage; the choice holds for this page
  }
  changed();
}

/** A store says which bots, rooms and conversations are its instance's. */
export function registerOwners(naam: string, ids: Iterable<string>): void {
  for (const id of ids) owners.set(id, naam);
}

/** The instance a bot, room or conversation belongs to; null with one instance. */
export function omgevingVan(id: string | null | undefined): string | null {
  return (id && owners.get(id)) || null;
}

function ownerOf(path: string, body?: unknown): string | null {
  const url = new URL(path, "http://omgeving.invalid");
  const named = ID_PATH.exec(url.pathname)?.[1];
  const fromQuery = named ?? url.searchParams.get("threadId") ?? url.searchParams.get("botId");
  if (fromQuery && owners.has(fromQuery)) return owners.get(fromQuery)!;
  if (typeof body === "string" && body.length < 65_536 && body.startsWith("{")) {
    try {
      const json = JSON.parse(body) as Record<string, unknown>;
      for (const key of ["threadId", "botId", "groupId"]) {
        const id = json[key];
        if (typeof id === "string" && owners.has(id)) return owners.get(id)!;
      }
    } catch {
      // not JSON: the active instance
    }
  }
  return null;
}

/** The path a request for this app's server must take. `naam` names the
 * instance outright; otherwise the owner of what the path (or JSON body)
 * names, else the active instance. Only /api/ paths, only with a door. */
export function omgevingPath(path: string, naam?: string | null, body?: unknown): string {
  if (!open.length || !path.startsWith("/api/")) return path;
  const target = naam ?? ownerOf(path, body) ?? actief;
  return target ? `/o/${target}${path}` : path;
}

let installed = false;

/** Every fetch of an /api/ path in this window goes through omgevingPath:
 * one rule for api(), the direct fetches, a session check and a read mark. */
function installFetch(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string") return original(omgevingPath(input, null, init?.body), init);
    if (input instanceof URL && input.origin === window.location.origin) {
      return original(`${omgevingPath(input.pathname, null, init?.body)}${input.search}`, init);
    }
    return original(input, init);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called whenever another instance becomes the active one. */
export function onActieveOmgeving(listener: () => void): () => void {
  return subscribe(listener);
}

export function useActieveOmgeving(): string | null {
  return useSyncExternalStore(subscribe, () => actief, () => actief);
}

/** Test seam: the window as if the door opened these. */
export function setOmgevingenForTest(next: { open?: OpenOmgeving[]; actief?: string | null; owners?: Record<string, string> }): void {
  open = next.open ?? [];
  actief = next.actief ?? null;
  owners.clear();
  for (const [id, naam] of Object.entries(next.owners ?? {})) owners.set(id, naam);
  changed();
}
