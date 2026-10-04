// Office view (fork): bots with nothing to do stretch their legs — now and
// then one gets up, walks the corridors to another team's office, stands in
// its doorway a moment and walks back. Chiefs (PMs, the hero) never leave
// their desk; a bot with work, or one waiting on you, stays put. Pure: who
// walks when (seeded, so every screen agrees) and the route through the
// corridors; the scene animates it.
import { CORRIDOR, type OfficeDesk, type OfficeLayout, type OfficeRoom, type OfficeSeat } from "./office-layout";

/** A wander is planned per slot of this length. */
export const WANDER_SLOT_MS = 120_000;
/** Out of 100: how many idle bots go for a walk in a slot. */
export const WANDER_CHANCE = 35;
/** A whole walk (there, a pause, back) fits in this. */
export const WANDER_BUDGET_MS = 75_000;
export const WALK_SPEED = 1.15; // metres per second
export const LINGER_MS = 6_000;

export interface Point { x: number; z: number }

/** Who may wander: not a chief, not working, not waiting on you. */
export function mayWander(seat: { chief: boolean; working: boolean; waiting: boolean }): boolean {
  return !seat.chief && !seat.working && !seat.waiting;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** This slot's walk for a bot, if it takes one: when it sets off and whose
 * office it visits. The same answer on every screen (seeded by id and slot). */
export function wanderPlan(botId: string, now: number, rooms: string[], home: string): { slot: number; startAt: number; visit: string } | null {
  const slot = Math.floor(now / WANDER_SLOT_MS);
  const seed = hash(`${botId}:${slot}`);
  const others = rooms.filter((id) => id !== home);
  if (!others.length || seed % 100 >= WANDER_CHANCE) return null;
  const startAt = slot * WANDER_SLOT_MS + (seed % (WANDER_SLOT_MS - WANDER_BUDGET_MS));
  return { slot, startAt, visit: others[(seed >>> 8) % others.length] };
}

const inside = (p: Point, room: OfficeRoom, margin = 0) =>
  Math.abs(p.x - room.x) < room.width / 2 + margin && Math.abs(p.z - room.z) < room.depth / 2 + margin;

/** The corridor just outside an office's door. */
export function doorOutside(room: OfficeRoom): Point {
  return { x: room.doorX, z: room.z + room.depth / 2 + CORRIDOR / 2 };
}

/** From a seat to just inside its office door, around the desk. */
function seatToDoor(seat: OfficeSeat, room: OfficeRoom, desk: OfficeDesk): Point[] {
  const table = desk.tables[0];
  const exitZ = room.z + room.depth / 2 - 0.6;
  const route: Point[] = [{ x: seat.x, z: seat.z }];
  if (table && seat.z < table.z) {
    // seated behind the desk: round its nearer end first
    const toward = room.doorX >= seat.x ? 1 : -1;
    const sideX = table.x + toward * (table.width / 2 + 0.55);
    route.push({ x: sideX, z: seat.z }, { x: sideX, z: exitZ });
  } else {
    route.push({ x: seat.x, z: exitZ });
  }
  route.push({ x: room.doorX, z: exitZ });
  return route;
}

/** A vertical corridor (constant x) from one row's corridor to another's that
 * runs through no office; the shortest detour wins. */
function crossingX(layout: OfficeLayout, from: Point, to: Point): number {
  const low = Math.min(from.z, to.z);
  const high = Math.max(from.z, to.z);
  const candidates = new Set<number>([layout.bounds.minX + CORRIDOR / 2, layout.bounds.maxX - CORRIDOR / 2]);
  for (const room of layout.rooms) {
    candidates.add(room.x - room.width / 2 - CORRIDOR / 2);
    candidates.add(room.x + room.width / 2 + CORRIDOR / 2);
  }
  const clear = [...candidates].filter((x) => !layout.rooms.some((room) =>
    Math.abs(x - room.x) < room.width / 2 + 0.2 && room.z + room.depth / 2 > low && room.z - room.depth / 2 < high));
  return clear.sort((a, b) => Math.abs(from.x - a) + Math.abs(a - to.x) - (Math.abs(from.x - b) + Math.abs(b - to.x)))[0] ?? layout.bounds.minX + CORRIDOR / 2;
}

/** The way from a seat to the doorway of the office it visits: out of its
 * own office, along the corridors (straight lines, never through an office),
 * and a step into the other door. Walk it backwards to come home. */
export function walkPath(layout: OfficeLayout, seat: OfficeSeat, homeId: string, visitId: string): Point[] {
  const index = layout.rooms.findIndex((room) => room.id === homeId);
  const home = layout.rooms[index];
  const visit = layout.rooms.find((room) => room.id === visitId);
  const desk = layout.desks[index];
  if (!home || !visit || !desk) return [];
  const out = doorOutside(home);
  const there = doorOutside(visit);
  const route = seatToDoor(seat, home, desk);
  route.push(out);
  if (Math.abs(out.z - there.z) > 0.01) {
    const x = crossingX(layout, out, there);
    route.push({ x, z: out.z }, { x, z: there.z });
  }
  route.push(there, { x: visit.doorX, z: visit.z + visit.depth / 2 - 0.7 });
  // drop repeats so every leg has a length
  return route.filter((p, i) => i === 0 || Math.hypot(p.x - route[i - 1].x, p.z - route[i - 1].z) > 0.01);
}

/** Total length of a route, in metres. */
export function pathLength(path: Point[]): number {
  return path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i].x, p.z - path[i].z), 0);
}

/** Where along the route after walking `distance` metres, and which way. */
export function pointAlong(path: Point[], distance: number): { at: Point; heading: number } {
  let left = Math.max(0, distance);
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const leg = Math.hypot(b.x - a.x, b.z - a.z);
    const heading = Math.atan2(b.x - a.x, b.z - a.z);
    if (left <= leg) return { at: { x: a.x + ((b.x - a.x) * left) / leg, z: a.z + ((b.z - a.z) * left) / leg }, heading };
    left -= leg;
  }
  const last = path.at(-1) ?? { x: 0, z: 0 };
  const prev = path.at(-2) ?? last;
  return { at: last, heading: Math.atan2(last.x - prev.x, last.z - prev.z) };
}

/** For tests: does a leg of the route cut through an office it should not? */
export function crossesOffice(layout: OfficeLayout, path: Point[], allowed: string[]): boolean {
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    for (let t = 0; t <= 1; t += 0.05) {
      const p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      if (layout.rooms.some((room) => !allowed.includes(room.id) && inside(p, room))) return true;
    }
  }
  return false;
}
