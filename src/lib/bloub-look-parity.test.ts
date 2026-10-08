// shared/bloub-look keeps its own copy of bloub's ids (shared/ must not import
// the vendored engine). This keeps the copy equal to the engine, order included.
import { describe, expect, it } from "vitest";

import { COLORS, SHAPES } from "@/vendor/bloub/skins";
import { EXPRESSIONS } from "@/vendor/bloub/expressions";
import { BLOUB_COLOR_IDS, BLOUB_EXPRESSION_IDS, BLOUB_SHAPE_IDS } from "../../shared/bloub-look";

describe("bloub id lists", () => {
  it("match the vendored engine's catalogues", () => {
    expect([...BLOUB_SHAPE_IDS]).toEqual(SHAPES.map((shape) => shape.id));
    expect([...BLOUB_EXPRESSION_IDS]).toEqual(EXPRESSIONS.map((expression) => expression.id));
    expect([...BLOUB_COLOR_IDS]).toEqual(COLORS.map((color) => color.id));
  });
});
