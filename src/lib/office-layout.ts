// Office view (fork): where every team's desks and every bot's seat stand in
// the 3D office. Pure geometry, no three.js, so it is testable. A team works
// at one shared desk, long enough for the whole team, facing each other along
// both long sides; its chief (PM) sits alone at a small desk of its own beside
// it, looking at the team. The unsectioned chief gets its own desk in front.
// Units are metres; y is up, the camera looks from +z.

export interface OfficeTeam {
  id: string;
  label: string;
  bots: { id: string; chiefOfStaff?: boolean }[];
}

export interface OfficeSeat {
  botId: string;
  x: number;
  z: number;
  /** rotation around y; 0 faces +z */
  rotY: number;
}

/** A table top: centre, size along x (width) and along z (depth). */
export interface OfficeTable {
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface OfficeDesk {
  id: string;
  label: string;
  /** centre of the team's zone */
  x: number;
  z: number;
  /** the zone's size, chairs included */
  width: number;
  depth: number;
  tables: OfficeTable[];
  seats: OfficeSeat[];
}

export interface OfficeLayout {
  desks: OfficeDesk[];
  /** floor rectangle around every desk */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

export const SEAT_PITCH = 1.5;
export const DESK_DEPTH = 1.8;
/** bot distance from the desk edge */
export const SEAT_GAP = 0.5;
/** the chief's own desk: across x it faces the team, along z it is wide */
export const CHIEF_DESK = { width: 1, depth: 1.5 };
/** floor between the chief's desk and the team's desk */
export const CHIEF_GAP = 1.4;
/** room behind a seated bot for its chair */
const CHAIR = 0.6;
const CELL_GAP_X = 2.5;
const CELL_GAP_Z = 4;

/** A team's zone centred on the origin, with its tables and seats. */
export function deskFor(team: OfficeTeam): OfficeDesk {
  const chief = team.bots.length > 1 ? (team.bots.find((bot) => bot.chiefOfStaff) ?? null) : null;
  const rest = team.bots.filter((bot) => bot !== chief);
  const perSide = Math.max(1, Math.ceil(rest.length / 2));
  const length = Math.max(2, perSide * SEAT_PITCH + 0.4);
  const sideZ = DESK_DEPTH / 2 + SEAT_GAP;
  // x runs left to right: [chair, chief, chief desk, gap] team desk
  const chiefSpan = chief ? CHAIR + SEAT_GAP + CHIEF_DESK.width + CHIEF_GAP : 0;
  const width = chiefSpan + length;
  const left = -width / 2;
  const teamX = left + chiefSpan + length / 2;
  const tables: OfficeTable[] = [{ x: teamX, z: 0, width: length, depth: DESK_DEPTH }];
  const seats: OfficeSeat[] = [];
  if (chief) {
    const chiefX = left + CHAIR;
    seats.push({ botId: chief.id, x: chiefX, z: 0, rotY: Math.PI / 2 });
    tables.push({ x: chiefX + SEAT_GAP + CHIEF_DESK.width / 2, z: 0, width: CHIEF_DESK.width, depth: CHIEF_DESK.depth });
  }
  rest.forEach((bot, index) => {
    const back = index % 2 === 0; // alternate so both sides fill evenly
    const slot = Math.floor(index / 2);
    const count = back ? Math.ceil(rest.length / 2) : Math.floor(rest.length / 2);
    const x = teamX + (slot - (count - 1) / 2) * SEAT_PITCH;
    seats.push(back ? { botId: bot.id, x, z: -sideZ, rotY: 0 } : { botId: bot.id, x, z: sideZ, rotY: Math.PI });
  });
  return { id: team.id, label: team.label, x: 0, z: 0, width, depth: DESK_DEPTH + 2 * (SEAT_GAP + CHAIR), tables, seats };
}

function place(desk: OfficeDesk, x: number, z: number): OfficeDesk {
  return {
    ...desk,
    x,
    z,
    tables: desk.tables.map((table) => ({ ...table, x: table.x + x, z: table.z + z })),
    seats: desk.seats.map((seat) => ({ ...seat, x: seat.x + x, z: seat.z + z })),
  };
}

/** Teams in rows of `columns` desks (about square), the hero desk in front. */
export function officeLayout(teams: OfficeTeam[], hero: OfficeTeam | null = null): OfficeLayout {
  const desks = teams.filter((team) => team.bots.length > 0).map(deskFor);
  const columns = Math.max(1, Math.ceil(Math.sqrt(desks.length)));
  const cellWidth = Math.max(0, ...desks.map((desk) => desk.width)) + CELL_GAP_X;
  const cellDepth = Math.max(0, ...desks.map((desk) => desk.depth)) + CELL_GAP_Z;
  const rows = Math.ceil(desks.length / columns);
  const placed = desks.map((desk, index) => {
    const row = Math.floor(index / columns);
    const inRow = Math.min(columns, desks.length - row * columns);
    const col = index % columns;
    // rows run away from the camera (-z); a short last row stays centred
    return place(desk, (col - (inRow - 1) / 2) * cellWidth, -(row - (rows - 1) / 2) * cellDepth);
  });
  if (hero && hero.bots.length) {
    const front = placed.length ? Math.max(...placed.map((desk) => desk.z)) + cellDepth : 0;
    const desk = deskFor({ ...hero, bots: hero.bots.map((bot) => ({ id: bot.id })) });
    placed.push(place(desk, 0, front));
  }
  const bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  for (const desk of placed) {
    const { width, depth } = desk;
    bounds.minX = Math.min(bounds.minX, desk.x - width / 2);
    bounds.maxX = Math.max(bounds.maxX, desk.x + width / 2);
    bounds.minZ = Math.min(bounds.minZ, desk.z - depth / 2);
    bounds.maxZ = Math.max(bounds.maxZ, desk.z + depth / 2);
  }
  return { desks: placed, bounds };
}

/** One string per layout shape, so the scene only rebuilds when seats move. */
export function officeSignature(teams: OfficeTeam[], hero: OfficeTeam | null): string {
  const part = (team: OfficeTeam) => `${team.id}:${team.label}:${team.bots.map((bot) => `${bot.id}${bot.chiefOfStaff ? "*" : ""}`).join(",")}`;
  return [hero ? `hero=${part(hero)}` : "", ...teams.map(part)].join("|");
}

/** The thread a click on a bot opens: the newest conversation, not a routine run. */
export function latestThreadId(bot: { threadId: string; tasks?: { threadId: string; routineRunId?: string; createdAt: number; updatedAt?: number }[] }): string {
  let best: { threadId: string; at: number } | null = null;
  for (const task of bot.tasks ?? []) {
    if (task.routineRunId) continue;
    const at = task.updatedAt ?? task.createdAt;
    if (!best || at > best.at) best = { threadId: task.threadId, at };
  }
  return best?.threadId ?? bot.threadId;
}
