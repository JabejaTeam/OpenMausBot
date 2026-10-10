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

// One row per team: the sidebar shows each team's lead (its chief, else its
// first bot); the rest of the team opens on demand. "Unassigned" is no team,
// so it has no lead and its bots all show.
export function teamLead<B, R>(group: SimpleGroup<B, R>): B | null {
  return group.section ? (group.bots[0] ?? null) : null;
}

/** The team you are in: the one holding the open bot or room, which shows
 * its members under its row. null outside a team (no section) or unknown. */
export function openTeamOf<B extends { id: string }, R extends { id: string }>(
  groups: SimpleGroup<B, R>[],
  id: string | null | undefined,
): SimpleGroupId | null {
  if (!id) return null;
  const group = groups.find((g) => g.bots.some((bot) => bot.id === id) || g.rooms.some((room) => room.id === id));
  return group?.section ? group.id : null;
}

export type SimpleRow<B, R> =
  | { kind: "team"; key: string; group: SimpleGroup<B, R>; lead: B; at: number }
  | { kind: "bot"; key: string; bot: B; at: number }
  | { kind: "room"; key: string; room: R; at: number };

/** The list as rows, like Messages: one row per team (its lead), every bot
 * and room without a team on its own, the newest activity on top (`at`,
 * src/lib/thread-channel.ts lastActivityForMe). Rows without any keep the
 * groups' order underneath. */
export function simpleSidebarRows<B extends { id: string }, R extends { id: string }>(
  groups: SimpleGroup<B, R>[],
  activityAt: (item: B | R) => number,
): SimpleRow<B, R>[] {
  const rows: SimpleRow<B, R>[] = [];
  for (const group of groups) {
    const lead = teamLead(group);
    if (lead) {
      const at = Math.max(0, ...group.bots.map(activityAt), ...group.rooms.map(activityAt));
      rows.push({ kind: "team", key: group.id, group, lead, at });
      continue;
    }
    for (const bot of group.bots) rows.push({ kind: "bot", key: bot.id, bot, at: activityAt(bot) });
    for (const room of group.rooms) rows.push({ kind: "room", key: room.id, room, at: activityAt(room) });
  }
  return rows.sort((a, b) => b.at - a.at);
}
