import { describe, expect, it } from "vitest";
import { startsTimeBlock, TIME_GAP_MS } from "./time-separator";

describe("startsTimeBlock", () => {
  const at = new Date(2026, 9, 4, 22, 0).getTime();

  it("starts the chat with a time", () => {
    expect(startsTimeBlock(undefined, at)).toBe(true);
  });

  it("keeps a running conversation in one block", () => {
    expect(startsTimeBlock(at, at + TIME_GAP_MS - 1)).toBe(false);
  });

  it("starts a block after a pause", () => {
    expect(startsTimeBlock(at, at + TIME_GAP_MS)).toBe(true);
  });

  it("starts a block on a new day, however short the pause", () => {
    const late = new Date(2026, 9, 4, 23, 59).getTime();
    expect(startsTimeBlock(late, late + 2 * 60_000)).toBe(true);
  });
});
