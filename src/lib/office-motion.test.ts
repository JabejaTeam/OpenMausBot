import { describe, expect, it } from "vitest";
import { advance, EASE_IN_OUT_CSS, easeInOut, glideShift, MAX_STEP_MS, progressOf } from "./office-motion";

describe("advance", () => {
  it("never jumps: a stalled frame (the chat rendering) moves one capped step", () => {
    expect(advance(0, 16)).toBe(16);
    expect(advance(100, 400)).toBeCloseTo(100 + MAX_STEP_MS);
    expect(advance(100, -5)).toBe(100);
  });

  it("keeps every frame's progress change small, however slow the frames", () => {
    const duration = 850;
    let elapsed = 0;
    let last = 0;
    for (const delta of [16, 16, 180, 16, 600, 16, 16, 250, 16]) {
      elapsed = advance(elapsed, delta);
      const eased = easeInOut(progressOf(elapsed, duration));
      expect(eased - last).toBeLessThan(0.1);
      last = eased;
    }
  });
});

describe("glideShift", () => {
  it("puts the bot where it should be: start, end, and on the way", () => {
    // start: camera has it at 488, no shift yet
    expect(glideShift(488, 488, 310, 0, 820)).toBe(0);
    // end: camera centres it (720 of 1440); visible middle is (1440 - 820) / 2 = 310
    expect(glideShift(720, 488, 310, 1, 820)).toBe(820);
  });

  it("makes the bot's screen x move straight, whatever the camera's own path does", () => {
    // a camera path that overshoots on its own (perspective): 488 → 760 → 720
    const cameraPath = [488, 560, 650, 730, 760, 745, 720];
    const eased = [0, 0.2, 0.45, 0.7, 0.88, 0.97, 1];
    let last = Infinity;
    cameraPath.forEach((cameraX, i) => {
      const shift = glideShift(cameraX, 488, 310, eased[i], 820);
      const screenX = cameraX - shift / 2;
      expect(screenX).toBeLessThanOrEqual(last + 1);
      last = screenX;
    });
    expect(last).toBeCloseTo(310, 0);
  });
});

describe("EASE_IN_OUT_CSS", () => {
  it("is the camera's own curve, so the panel and the flight move as one", () => {
    const [x1, y1, x2, y2] = EASE_IN_OUT_CSS.match(/[\d.]+/g)!.map(Number);
    const at = (a: number, b: number, u: number) => 3 * a * u * (1 - u) ** 2 + 3 * b * u ** 2 * (1 - u) + u ** 3;
    for (let t = 0.05; t < 1; t += 0.05) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 40; i += 1) {
        const mid = (lo + hi) / 2;
        if (at(x1, x2, mid) < t) lo = mid;
        else hi = mid;
      }
      expect(Math.abs(at(y1, y2, lo) - easeInOut(t))).toBeLessThan(0.03);
    }
  });
});
