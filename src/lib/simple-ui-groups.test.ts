import { describe, expect, it } from "vitest";
import { lastSentAt, simpleSidebarLayout, simpleSidebarRows, teamLead, openTeamOf } from "./simple-ui-groups";

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

  it("opens the team of any of its bots or rooms, its lead included, never an unassigned row", () => {
    expect(openTeamOf(groups, "code")).toBe("section:A");
    expect(openTeamOf(groups, "room")).toBe("section:A");
    expect(openTeamOf(groups, "pm")).toBe("section:A");
    expect(openTeamOf(groups, "loose")).toBeNull();
    expect(openTeamOf(groups, "nope")).toBeNull();
    expect(openTeamOf(groups, null)).toBeNull();
  });
});

describe("lastSentAt", () => {
  it("is the newest message the person typed, not one through the API", () => {
    expect(lastSentAt([
      { role: "user", at: 5 },
      { role: "bot", at: 9 },
      { role: "user", at: 7, via: "api" },
    ])).toBe(5);
    expect(lastSentAt([{ role: "bot", at: 3 }])).toBe(0);
  });
});

describe("simpleSidebarRows", () => {
  it("puts the team or bot you last wrote to on top, a team counting all its members", () => {
    const groups = simpleSidebarLayout(
      [{ id: "pmA", section: "A", chiefOfStaff: true }, { id: "codeA", section: "A" }, { id: "pmB", section: "B", chiefOfStaff: true }, { id: "loose" }],
      [],
      ["A", "B"],
    ).groups;
    const sent: Record<string, number> = { codeA: 30, pmB: 20, loose: 40 };
    const rows = simpleSidebarRows(groups, (item) => sent[item.id] ?? 0);
    expect(rows.map((row) => row.key)).toEqual(["loose", "section:A", "section:B"]);
  });

  it("keeps the groups' order for rows never written to", () => {
    const groups = simpleSidebarLayout([{ id: "x", section: "X" }, { id: "y", section: "Y" }], [], ["X", "Y"]).groups;
    expect(simpleSidebarRows(groups, () => 0).map((row) => row.key)).toEqual(["section:X", "section:Y"]);
  });
});
