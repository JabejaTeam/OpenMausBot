import { describe, expect, it } from "vitest";
import { DEFAULT_WALL_COLORS, isDarkWall, looksKey, TEAM_WALL_SWATCHES, wallColorFor } from "./office-team-looks";

describe("wallColorFor", () => {
  it("uses the team's own colour, else a calm default by order", () => {
    expect(wallColorFor("section:Jabeja", 0, { "section:Jabeja": { color: "#2f6fde" } })).toBe("#2f6fde");
    expect(wallColorFor("section:Ripal", 7, {})).toBe(DEFAULT_WALL_COLORS[7 % DEFAULT_WALL_COLORS.length]);
  });
});

describe("swatches", () => {
  it("are valid hex colours, the defaults first", () => {
    for (const color of TEAM_WALL_SWATCHES) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    expect(TEAM_WALL_SWATCHES.slice(0, DEFAULT_WALL_COLORS.length)).toEqual(DEFAULT_WALL_COLORS);
  });

  it("tell dark walls from light ones", () => {
    expect(isDarkWall("#3b3f46")).toBe(true);
    expect(isDarkWall("#d9dde3")).toBe(false);
  });
});

describe("looksKey", () => {
  it("changes when a look changes, not when the order does", () => {
    const a = { x: { color: "#111111", updatedAt: 1 }, y: { color: "#222222", updatedAt: 2 } };
    const b = { y: { color: "#222222", updatedAt: 2 }, x: { color: "#111111", updatedAt: 1 } };
    expect(looksKey(a)).toBe(looksKey(b));
    expect(looksKey(a)).not.toBe(looksKey({ ...a, x: { color: "#111111", updatedAt: 3 } }));
  });
});
