import { describe, expect, it } from "vitest";
import { CORRIDOR, deskFor, DESK_DEPTH, DOOR_WIDTH, latestThreadId, officeLayout, officeSignature, ROOM_PAD, SEAT_PITCH } from "./office-layout";

const team = (id: string, n: number, chief = false) => ({
  id,
  label: id,
  bots: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, chiefOfStaff: chief && i === 0 })),
});

describe("deskFor", () => {
  it("seats the chief alone at its own desk, beside the team's desk", () => {
    const desk = deskFor(team("code", 6, true));
    expect(desk.seats).toHaveLength(6);
    expect(desk.tables).toHaveLength(2);
    const [shared, own] = desk.tables;
    const [chief, ...rest] = desk.seats;
    expect(chief.botId).toBe("code-0");
    // the chief's desk stands apart, between the chief and the team
    expect(own.x + own.width / 2).toBeLessThan(shared.x - shared.width / 2);
    expect(chief.x).toBeLessThan(own.x - own.width / 2);
    expect(Math.abs(chief.z - own.z)).toBeLessThan(own.depth / 2);
    // nobody else sits at the chief's desk; the team fills both long sides
    for (const seat of rest) {
      expect(Math.abs(seat.x - shared.x)).toBeLessThan(shared.width / 2);
      expect(Math.abs(seat.z)).toBeGreaterThan(DESK_DEPTH / 2);
    }
    expect(rest.filter((s) => s.z < 0)).toHaveLength(3);
    expect(rest.filter((s) => s.z > 0)).toHaveLength(2);
  });

  it("gives a team without a chief just the shared desk", () => {
    expect(deskFor(team("plain", 3)).tables).toHaveLength(1);
  });

  it("grows with the team, never overlapping seats", () => {
    const desk = deskFor(team("big", 11));
    expect(desk.tables[0].width).toBeGreaterThanOrEqual(6 * SEAT_PITCH);
    const keys = new Set(desk.seats.map((s) => `${s.x.toFixed(2)},${s.z}`));
    expect(keys.size).toBe(11);
  });

  it("faces every bot toward its desk", () => {
    const desk = deskFor(team("t", 3, true));
    for (const seat of desk.seats) {
      const table = desk.tables.reduce((a, b) => (Math.hypot(a.x - seat.x, a.z - seat.z) < Math.hypot(b.x - seat.x, b.z - seat.z) ? a : b));
      expect(Math.sin(seat.rotY) * (table.x - seat.x) + Math.cos(seat.rotY) * (table.z - seat.z)).toBeGreaterThan(0);
    }
  });
});

describe("officeLayout", () => {
  it("never lets two desks overlap and puts the hero in front", () => {
    const teams = Array.from({ length: 7 }, (_, i) => team(`t${i}`, (i % 4) + 1, i % 2 === 0));
    const { desks, bounds } = officeLayout(teams, { id: "hero", label: "Jarvis", bots: [{ id: "jarvis" }] });
    expect(desks).toHaveLength(8);
    for (const a of desks) for (const b of desks) {
      if (a === b) continue;
      const apart = Math.abs(a.x - b.x) >= (a.width + b.width) / 2 + 2 || Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2 + 2;
      expect(apart).toBe(true);
    }
    const hero = desks.at(-1)!;
    expect(hero.id).toBe("hero");
    expect(hero.z).toBeGreaterThan(Math.max(...desks.slice(0, -1).map((d) => d.z)));
    for (const seat of desks.flatMap((d) => d.seats)) {
      expect(seat.x).toBeGreaterThan(bounds.minX);
      expect(seat.x).toBeLessThan(bounds.maxX);
      expect(seat.z).toBeGreaterThan(bounds.minZ);
      expect(seat.z).toBeLessThan(bounds.maxZ);
    }
  });

  it("skips empty teams", () => {
    expect(officeLayout([team("a", 0), team("b", 1)]).desks.map((d) => d.id)).toEqual(["b"]);
  });

  it("changes signature only when seats change", () => {
    expect(officeSignature([team("a", 2)], null)).toBe(officeSignature([team("a", 2)], null));
    expect(officeSignature([team("a", 2)], null)).not.toBe(officeSignature([team("a", 3)], null));
  });
});

describe("officeLayout: the building", () => {
  const teams = Array.from({ length: 15 }, (_, i) => team(`t${i}`, i === 3 ? 10 : (i % 4) + 1, i % 2 === 0));
  const { desks, rooms, bounds } = officeLayout(teams, { id: "hero", label: "Jarvis", bots: [{ id: "jarvis" }] });

  it("gives every team a closed office its desk fits in, with room to spare", () => {
    expect(rooms).toHaveLength(desks.length);
    desks.forEach((desk, i) => {
      const room = rooms[i];
      expect(room.id).toBe(desk.id);
      expect(desk.x - desk.width / 2).toBeGreaterThanOrEqual(room.x - room.width / 2 + ROOM_PAD - 1e-9);
      expect(desk.x + desk.width / 2).toBeLessThanOrEqual(room.x + room.width / 2 - ROOM_PAD + 1e-9);
      expect(desk.z - desk.depth / 2).toBeGreaterThanOrEqual(room.z - room.depth / 2 + ROOM_PAD - 1e-9);
      expect(desk.z + desk.depth / 2).toBeLessThanOrEqual(room.z + room.depth / 2 - ROOM_PAD + 1e-9);
    });
  });

  it("keeps a corridor between every two offices, and round the building", () => {
    for (const a of rooms) for (const b of rooms) {
      if (a === b) continue;
      const gapX = Math.abs(a.x - b.x) - (a.width + b.width) / 2;
      const gapZ = Math.abs(a.z - b.z) - (a.depth + b.depth) / 2;
      expect(Math.max(gapX, gapZ)).toBeGreaterThanOrEqual(CORRIDOR - 1e-9);
    }
    for (const room of rooms) {
      expect(room.x - room.width / 2 - bounds.minX).toBeGreaterThanOrEqual(CORRIDOR - 1e-9);
      expect(bounds.maxZ - (room.z + room.depth / 2)).toBeGreaterThanOrEqual(CORRIDOR - 1e-9);
    }
  });

  it("puts the door in the front wall, inside the office's width", () => {
    for (const room of rooms) {
      expect(Math.abs(room.doorX - room.x)).toBeLessThanOrEqual(room.width / 2 - DOOR_WIDTH / 2);
    }
  });

  it("lines offices up in columns and rows, the hero's office in front", () => {
    const hero = rooms.at(-1)!;
    expect(hero.hero).toBe(true);
    expect(hero.z - hero.depth / 2).toBeGreaterThan(Math.max(...rooms.slice(0, -1).map((room) => room.z + room.depth / 2)));
    const lefts = new Set(rooms.slice(0, -1).map((room) => (room.x - room.width / 2).toFixed(3)));
    expect(lefts.size).toBeLessThanOrEqual(4);
  });
});

describe("latestThreadId", () => {
  it("opens the newest conversation, never a routine run", () => {
    expect(latestThreadId({
      threadId: "current",
      tasks: [
        { threadId: "current", createdAt: 1, updatedAt: 5 },
        { threadId: "newest", createdAt: 2, updatedAt: 9 },
        { threadId: "routine", createdAt: 3, updatedAt: 20, routineRunId: "r" },
      ],
    })).toBe("newest");
    expect(latestThreadId({ threadId: "only" })).toBe("only");
  });
});
