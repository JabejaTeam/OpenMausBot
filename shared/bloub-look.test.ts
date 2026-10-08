import { describe, expect, it } from "vitest";

import { BLOUB_COLOR_FOR_MAUS, bloubLookFor, parseBloubLook } from "./bloub-look.ts";

describe("bloubLookFor", () => {
  it("gives an unstyled bot a circle, a neutral face and its colour's nearest bloub colour", () => {
    expect(bloubLookFor({ color: "purple" })).toEqual({ shape: "cercle", expression: "neutre", color: "violet" });
    expect(bloubLookFor({ color: "yellow", bloub: null })).toEqual({ shape: "cercle", expression: "neutre", color: "ambre" });
  });

  it("maps every bot colour to a bloub colour", () => {
    for (const [maus, bloub] of Object.entries(BLOUB_COLOR_FOR_MAUS)) {
      expect(bloubLookFor({ color: maus as keyof typeof BLOUB_COLOR_FOR_MAUS }).color).toBe(bloub);
    }
  });

  it("returns a stored look as it is", () => {
    const look = { shape: "hexagone", expression: "somnolent", color: "encre" } as const;
    expect(bloubLookFor({ color: "green", bloub: look })).toEqual(look);
  });

  it("drops invalid ids field by field, keeping the valid ones", () => {
    expect(bloubLookFor({ color: "red", bloub: { shape: "star", expression: "fier", color: 7 } })).toEqual({
      shape: "cercle",
      expression: "fier",
      color: "rouge",
    });
  });
});

describe("parseBloubLook", () => {
  it("accepts only a complete look of known ids", () => {
    expect(parseBloubLook({ shape: "nuage", expression: "timide", color: "rose" })).toEqual({ shape: "nuage", expression: "timide", color: "rose" });
    expect(parseBloubLook({ shape: "nuage", expression: "timide" })).toBeNull();
    expect(parseBloubLook({ shape: "nuage", expression: "timide", color: "magenta" })).toBeNull();
    expect(parseBloubLook("cercle")).toBeNull();
  });
});
