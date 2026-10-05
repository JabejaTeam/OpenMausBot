import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module (preview)
import { FrameCap } from "./render-perf.js";

/** How many of `frames` display frames at `hz` the cap lets through. */
function drawn(hz: number, frames: number): number {
  const cap = new FrameCap(60);
  let count = 0;
  for (let i = 0; i < frames; i += 1) if (cap.ready(i * (1000 / hz))) count += 1;
  return count;
}

describe("FrameCap", () => {
  it("draws every frame of a 60 Hz display", () => {
    expect(drawn(60, 600)).toBe(600);
  });

  it("draws every other frame of a 120 Hz display", () => {
    expect(drawn(120, 1200)).toBe(600);
  });

  it("averages 60 on a 90 Hz display, not 45", () => {
    expect(drawn(90, 900)).toBeGreaterThanOrEqual(590);
  });
});
