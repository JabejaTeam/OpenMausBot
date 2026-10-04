import { describe, expect, it } from "vitest";
import { officeLayout } from "./office-layout";
import { placementFits, roomDecor } from "./office-furniture";

const team = (id: string, n: number, chief = false) => ({
  id,
  label: id,
  bots: Array.from({ length: n }, (_, i) => ({ id: `${id}-${i}`, chiefOfStaff: chief && i === 0 })),
});

describe("roomDecor", () => {
  const layout = officeLayout(
    Array.from({ length: 9 }, (_, i) => team(`t${i}`, i === 2 ? 10 : (i % 4) + 1, i % 2 === 0)),
    { id: "hero", label: "Jarvis", bots: [{ id: "jarvis" }] },
  );

  it("keeps every piece inside its office, off the desks and out of the doorway", () => {
    layout.rooms.forEach((room, i) => {
      for (const item of roomDecor(room, layout.desks[i])) {
        expect(placementFits(item, room, layout.desks[i]), `${room.id}: ${item.model} at ${item.x.toFixed(2)},${item.z.toFixed(2)}`).toBe(true);
      }
    });
  });

  it("lays a rug under the team's desk, within the walls", () => {
    layout.rooms.forEach((room, i) => {
      const rug = roomDecor(room, layout.desks[i]).find((item) => item.model === "rugRectangle")!;
      expect(rug.stretch!.x).toBeLessThan(room.width);
      expect(rug.stretch!.z).toBeLessThan(room.depth);
    });
  });

  it("gives only the chief's office a sofa", () => {
    const sofas = layout.rooms.filter((room, i) => roomDecor(room, layout.desks[i]).some((item) => item.model === "loungeDesignSofa"));
    expect(sofas.map((room) => room.id)).toEqual(["hero"]);
  });
});
