import { describe, expect, it } from "vitest";
import { prewarm, remember } from "./office-recent";

describe("remember", () => {
  it("puts the chat first, once, and keeps at most max", () => {
    expect(remember(["a", "b", "c"], "b", 3)).toEqual(["b", "a", "c"]);
    expect(remember(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("prewarm", () => {
  it("adds a hovered chat without ever dropping the open one", () => {
    expect(prewarm(["x", "a", "b"], "h", "b", 3)).toEqual(["b", "h", "x"]);
    expect(prewarm(["a", "b"], "a", "b", 3)).toEqual(["a", "b"]);
    expect(prewarm(["a", "b", "c"], "h", null, 3)).toEqual(["h", "a", "b"]);
  });
});
