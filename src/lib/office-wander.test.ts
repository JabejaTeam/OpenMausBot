import { describe, expect, it } from "vitest";
import { officeLayout } from "./office-layout";
import { crossesOffice, mayWander, pathLength, pointAlong, walkPath, WANDER_BUDGET_MS, WANDER_CHANCE, WANDER_SLOT_MS, wanderPlan } from "./office-wander";

const team = (id: string, n: number, chief = false) => ({
  id,
  label: id,
  bots: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, chiefOfStaff: chief && i === 0 })),
});
const layout = officeLayout(Array.from({ length: 9 }, (_, i) => team(`t${i}`, (i % 4) + 2, true)), { id: "hero", label: "Jarvis", bots: [{ id: "jarvis" }] });

describe("mayWander", () => {
  it("keeps chiefs, busy bots and bots waiting on you at their desk", () => {
    expect(mayWander({ chief: false, working: false, waiting: false })).toBe(true);
    expect(mayWander({ chief: true, working: false, waiting: false })).toBe(false);
    expect(mayWander({ chief: false, working: true, waiting: false })).toBe(false);
    expect(mayWander({ chief: false, working: false, waiting: true })).toBe(false);
  });
});

describe("wanderPlan", () => {
  const rooms = layout.rooms.map((room) => room.id);

  it("is the same on every screen, and fits its slot", () => {
    for (let slot = 0; slot < 50; slot += 1) {
      const now = slot * WANDER_SLOT_MS + 1234;
      const plan = wanderPlan("bot-a", now, rooms, "t0");
      expect(plan).toEqual(wanderPlan("bot-a", now + 5000, rooms, "t0"));
      if (!plan) continue;
      expect(plan.visit).not.toBe("t0");
      expect(plan.startAt + WANDER_BUDGET_MS).toBeLessThanOrEqual((plan.slot + 1) * WANDER_SLOT_MS);
    }
  });

  it("sends about the planned share of idle bots out", () => {
    let walks = 0;
    for (let bot = 0; bot < 400; bot += 1) if (wanderPlan(`bot-${bot}`, 7 * WANDER_SLOT_MS, rooms, "t0")) walks += 1;
    expect(walks / 400).toBeGreaterThan(WANDER_CHANCE / 100 - 0.08);
    expect(walks / 400).toBeLessThan(WANDER_CHANCE / 100 + 0.08);
  });
});

describe("walkPath", () => {
  it("goes from the seat through the corridors to the other door, never through an office", () => {
    layout.rooms.slice(0, -1).forEach((home, i) => {
      for (const seat of layout.desks[i].seats.slice(1)) {
        for (const visit of layout.rooms) {
          if (visit.id === home.id) continue;
          const path = walkPath(layout, seat, home.id, visit.id);
          expect(path[0]).toEqual({ x: seat.x, z: seat.z });
          expect(crossesOffice(layout, path, [home.id, visit.id]), `${home.id} → ${visit.id}`).toBe(false);
          for (let k = 1; k < path.length; k += 1) {
            const straight = Math.abs(path[k].x - path[k - 1].x) < 1e-9 || Math.abs(path[k].z - path[k - 1].z) < 1e-9;
            expect(straight).toBe(true);
          }
          const end = path.at(-1)!;
          expect(Math.abs(end.x - visit.doorX)).toBeLessThan(1e-9);
        }
      }
    });
  });

  it("walks along the route at the right place and heading", () => {
    const path = [{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 3, z: 2 }];
    expect(pathLength(path)).toBe(5);
    expect(pointAlong(path, 1).at).toEqual({ x: 0, z: 1 });
    expect(pointAlong(path, 3.5).at).toEqual({ x: 1.5, z: 2 });
    expect(pointAlong(path, 3.5).heading).toBeCloseTo(Math.PI / 2);
    expect(pointAlong(path, 99).at).toEqual({ x: 3, z: 2 });
  });
});
