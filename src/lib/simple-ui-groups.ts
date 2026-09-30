// Simple UI (fork): how the one-list sidebar files bots and rooms.
// The unsectioned chief sits on top on its own. Code bots gather under
// "Coding"; a PM goes to "Clients" unless its section also holds bots that
// are neither PM nor code (an in-house team keeps its PM). Everything else
// stays under its section; no section → "Unassigned". Bot⇄bot channels are
// left out: the "Messaged" line in a chat opens them.

export interface SimpleBot {
  id: string;
  hidden?: boolean;
  section?: string;
  kind?: string;
  chiefOfStaff?: boolean;
}

export interface SimpleRoom {
  id: string;
  dm?: boolean;
  section?: string;
}

export type SimpleGroupId = `section:${string}` | "clients" | "coding" | "unassigned";

export interface SimpleGroup<B, R> {
  id: SimpleGroupId;
  /** the section's own name; absent for the built-in groups */
  section?: string;
  bots: B[];
  rooms: R[];
}

export function simpleSidebarLayout<B extends SimpleBot, R extends SimpleRoom>(bots: B[], rooms: R[]) {
  const visible = bots.filter((bot) => !bot.hidden);
  const hero = visible.find((bot) => bot.chiefOfStaff && !bot.section?.trim()) ?? null;
  const inHouse = new Set(
    visible
      .filter((bot) => bot.section?.trim() && bot.kind !== "pm" && bot.kind !== "code")
      .map((bot) => bot.section!.trim()),
  );
  const sections = new Map<string, SimpleGroup<B, R>>();
  const clients: SimpleGroup<B, R> = { id: "clients", bots: [], rooms: [] };
  const coding: SimpleGroup<B, R> = { id: "coding", bots: [], rooms: [] };
  const unassigned: SimpleGroup<B, R> = { id: "unassigned", bots: [], rooms: [] };
  const sectionGroup = (name: string) => {
    let group = sections.get(name);
    if (!group) sections.set(name, (group = { id: `section:${name}`, section: name, bots: [], rooms: [] }));
    return group;
  };
  for (const bot of visible) {
    if (bot === hero) continue;
    const section = bot.section?.trim();
    if (bot.kind === "code") coding.bots.push(bot);
    else if (bot.kind === "pm" && !(section && inHouse.has(section))) clients.bots.push(bot);
    else if (section) sectionGroup(section).bots.push(bot);
    else unassigned.bots.push(bot);
  }
  for (const room of rooms) {
    if (room.dm) continue;
    const section = room.section?.trim();
    (section && sections.has(section) ? sectionGroup(section) : unassigned).rooms.push(room);
  }
  const groups = [...sections.values(), clients, coding, unassigned].filter(
    (group) => group.bots.length > 0 || group.rooms.length > 0,
  );
  return { hero, groups };
}

// Grok's list shows soft shapes, never the cursor. A bot that kept the default
// cursor body gets one of these, fixed per bot id; a chosen body is kept.
const SIMPLE_BODIES = ["drop", "blob", "squircle", "capsule", "circle"] as const;

export function simpleMascotBody(bot: { id?: string; name?: string; mascotBody?: string | null }): string {
  if (bot.mascotBody && bot.mascotBody !== "cursor") return bot.mascotBody;
  const key = bot.id ?? bot.name ?? "";
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SIMPLE_BODIES[hash % SIMPLE_BODIES.length];
}
