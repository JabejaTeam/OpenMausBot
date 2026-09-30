// Simple UI (fork): how the one-list sidebar files bots and rooms. The
// unsectioned chief sits on top on its own; every other bot and room stays in
// its own team (section), the team's chief first, teams in the workspace's
// section order; no section → "Unassigned". Bot⇄bot channels are left out: the "Messaged" line in a chat
// opens them.

export interface SimpleBot {
  id: string;
  hidden?: boolean;
  section?: string;
  chiefOfStaff?: boolean;
}

export interface SimpleRoom {
  id: string;
  dm?: boolean;
  section?: string;
}

export type SimpleGroupId = `section:${string}` | "unassigned";

export interface SimpleGroup<B, R> {
  id: SimpleGroupId;
  /** the section's own name; absent for "Unassigned" */
  section?: string;
  bots: B[];
  rooms: R[];
}

export function simpleSidebarLayout<B extends SimpleBot, R extends SimpleRoom>(
  bots: B[],
  rooms: R[],
  sectionOrder: string[] = [],
) {
  const visible = bots.filter((bot) => !bot.hidden);
  const hero = visible.find((bot) => bot.chiefOfStaff && !bot.section?.trim()) ?? null;
  const sections = new Map<string, SimpleGroup<B, R>>();
  for (const name of sectionOrder) {
    const trimmed = name.trim();
    if (trimmed && !sections.has(trimmed)) sections.set(trimmed, { id: `section:${trimmed}`, section: trimmed, bots: [], rooms: [] });
  }
  const unassigned: SimpleGroup<B, R> = { id: "unassigned", bots: [], rooms: [] };
  const groupFor = (section: string | undefined) => {
    const name = section?.trim();
    if (!name) return unassigned;
    let group = sections.get(name);
    if (!group) sections.set(name, (group = { id: `section:${name}`, section: name, bots: [], rooms: [] }));
    return group;
  };
  for (const bot of visible) if (bot !== hero) groupFor(bot.section).bots.push(bot);
  for (const room of rooms) if (!room.dm) groupFor(room.section).rooms.push(room);
  // the team's chief (its PM) always leads the team; the rest keep their order
  for (const group of sections.values()) {
    group.bots = [...group.bots.filter((bot) => bot.chiefOfStaff), ...group.bots.filter((bot) => !bot.chiefOfStaff)];
  }
  const groups = [...sections.values(), unassigned].filter(
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
