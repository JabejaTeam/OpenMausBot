import { describe, expect, it } from "vitest";
import { DEFAULT_WALL_COLORS, isDarkWall, logoSize, looksKey, NAME_MAX_HEIGHT, TEAM_TEXT_SWATCHES, TEAM_WALL_SWATCHES, wallColorFor, wallSignFor } from "./office-team-looks";

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

describe("logoSize", () => {
  it("hangs a logo big, within the wall: wide marks by width, square ones by height", () => {
    expect(logoSize(2, 7)).toEqual({ width: 4.4, height: 2.2 });
    expect(logoSize(5, 10).width).toBe(7);
    expect(logoSize(5, 10).height).toBeCloseTo(1.4);
    expect(logoSize(1, 7)).toEqual({ width: 2.2, height: 2.2 });
    expect(logoSize(4, 4).width).toBeCloseTo(2.88);
    for (const [aspect, wall] of [[0.5, 6], [3, 5], [8, 12]]) {
      const size = logoSize(aspect, wall);
      expect(size.width).toBeLessThanOrEqual(wall * 0.72 + 1e-9);
      expect(size.height).toBeLessThanOrEqual(2.2 + 1e-9);
    }
  });
});

describe("wallSignFor", () => {
  it("hangs the logo, else writes the name in a colour that reads on the wall", () => {
    expect(wallSignFor("Ripal", { logo: "data:image/png;base64,AA==" }, "#0090df")).toEqual({ kind: "logo", source: "data:image/png;base64,AA==" });
    expect(wallSignFor("Beautea", undefined, "#3b3f46")).toEqual({ kind: "name", text: "Beautea", color: "#ffffff" });
    expect(wallSignFor("Beautea", undefined, "#d9dde3")).toEqual({ kind: "name", text: "Beautea", color: "#1d1d1f" });
    expect(wallSignFor("Beautea", { textColor: "#c2453a" }, "#d9dde3")).toEqual({ kind: "name", text: "Beautea", color: "#c2453a" });
  });

  it("a logo ignores a text colour; names are lettering, lower than a logo", () => {
    expect(wallSignFor("X", { logo: "data:image/png;base64,AA==", textColor: "#ffffff" }, "#000000").kind).toBe("logo");
    expect(logoSize(1.5, 7, NAME_MAX_HEIGHT).height).toBeCloseTo(1.2);
    for (const color of TEAM_TEXT_SWATCHES) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
