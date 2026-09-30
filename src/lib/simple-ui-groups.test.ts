import { describe, expect, it } from "vitest";
import { simpleSidebarLayout } from "./simple-ui-groups";

describe("simpleSidebarLayout", () => {
  const bots = [
    { id: "jarvis", chiefOfStaff: true },
    { id: "jabeja-pm", section: "Jabeja", kind: "pm", chiefOfStaff: true },
    { id: "ads", section: "Jabeja" },
    { id: "jabeja-code", section: "Jabeja", kind: "code" },
    { id: "ripal-pm", section: "Ripal", kind: "pm", chiefOfStaff: true },
    { id: "ripal-code", section: "Ripal", kind: "code" },
    { id: "gone", section: "Jabeja", hidden: true },
    { id: "loose" },
  ];
  const rooms = [
    { id: "sync" },
    { id: "jabeja-room", section: "Jabeja" },
    { id: "channel", dm: true },
  ];

  it("keeps every bot in its own team, in section order", () => {
    const { hero, groups } = simpleSidebarLayout(bots, rooms, ["Ripal", "Jabeja"]);
    expect(hero?.id).toBe("jarvis");
    expect(groups.map((g) => [g.id, g.bots.map((b) => b.id), g.rooms.map((r) => r.id)])).toEqual([
      ["section:Ripal", ["ripal-pm", "ripal-code"], []],
      ["section:Jabeja", ["jabeja-pm", "ads", "jabeja-code"], ["jabeja-room"]],
      ["unassigned", ["loose"], ["sync"]],
    ]);
  });

  it("drops empty groups and has no hero without an unsectioned chief", () => {
    const { hero, groups } = simpleSidebarLayout([{ id: "a", section: "X" }], [], ["Empty"]);
    expect(hero).toBeNull();
    expect(groups.map((g) => g.id)).toEqual(["section:X"]);
  });
});

describe("simpleMascotBody", () => {
  it("keeps a chosen body and swaps the cursor for a stable soft shape", async () => {
    const { simpleMascotBody } = await import("./simple-ui-groups");
    expect(simpleMascotBody({ id: "a", mascotBody: "star" })).toBe("star");
    const picked = simpleMascotBody({ id: "a", mascotBody: "cursor" });
    expect(picked).not.toBe("cursor");
    expect(simpleMascotBody({ id: "a" })).toBe(picked);
  });
});
