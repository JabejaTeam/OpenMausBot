import { describe, expect, it } from "vitest";
import { simpleSidebarLayout, teamLead, teamToOpen } from "./simple-ui-groups";

describe("simpleSidebarLayout", () => {
  const bots = [
    { id: "jarvis", chiefOfStaff: true },
    { id: "jabeja-pm", section: "Jabeja", kind: "pm", chiefOfStaff: true },
    { id: "ads", section: "Jabeja" },
    { id: "jabeja-code", section: "Jabeja", kind: "code" },
    { id: "ripal-code", section: "Ripal", kind: "code" },
    { id: "ripal-pm", section: "Ripal", kind: "pm", chiefOfStaff: true },
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

describe("team leads", () => {
  const { groups } = simpleSidebarLayout(
    [{ id: "pm", section: "A", chiefOfStaff: true }, { id: "code", section: "A" }, { id: "solo", section: "B" }, { id: "loose" }],
    [{ id: "room", section: "A" }, { id: "free" }],
  );

  it("leads a team with its chief, else its first bot; Unassigned has none", () => {
    expect(groups.map((g) => teamLead(g)?.id ?? null)).toEqual(["pm", "solo", null]);
  });

  it("opens the team of a hidden member, never for a lead or unassigned row", () => {
    expect(teamToOpen(groups, "code")).toBe("section:A");
    expect(teamToOpen(groups, "room")).toBe("section:A");
    expect(teamToOpen(groups, "pm")).toBeNull();
    expect(teamToOpen(groups, "solo")).toBeNull();
    expect(teamToOpen(groups, "loose")).toBeNull();
    expect(teamToOpen(groups, "free")).toBeNull();
    expect(teamToOpen(groups, "nope")).toBeNull();
  });
});
