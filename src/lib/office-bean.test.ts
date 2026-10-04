import { describe, expect, it } from "vitest";
import { beanMood, blinking, CHIEF_HEADGEAR, HEADGEAR, headgearFor, MOOD, workingMotion } from "./office-bean";

describe("headgearFor", () => {
  it("gives a chief the headset", () => {
    expect(headgearFor("pm-jabeja", true)).toBe(CHIEF_HEADGEAR);
  });
  it("is stable per bot and never the chief's headset", () => {
    for (const id of ["a", "seo", "code-jabeja", "x".repeat(40)]) {
      expect(headgearFor(id)).toBe(headgearFor(id));
      expect(HEADGEAR).toContain(headgearFor(id));
      expect(headgearFor(id)).not.toBe(CHIEF_HEADGEAR);
    }
  });
});

describe("beanMood", () => {
  it("waiting beats working, else idle", () => {
    expect(beanMood({ working: true, waiting: true })).toBe("waiting");
    expect(beanMood({ working: true })).toBe("working");
    expect(beanMood({})).toBe("idle");
    expect(beanMood(undefined)).toBe("idle");
  });
  it("idle is frozen", () => {
    expect(MOOD.idle.moves).toBe(false);
    expect(MOOD.idle.blinks).toBe(false);
    expect(MOOD.waiting.expression).toBe("surprised");
  });
});

describe("workingMotion", () => {
  it("bobs a centimetre at most and nods toward the screen", () => {
    for (let t = 0; t < 3; t += 0.1) {
      const { bob, pitch } = workingMotion(t, 1);
      expect(bob).toBeGreaterThanOrEqual(0);
      expect(bob).toBeLessThanOrEqual(0.01);
      expect(pitch).toBeGreaterThan(0.09);
      expect(pitch).toBeLessThan(0.27);
    }
  });
});

describe("blinking", () => {
  it("blinks briefly, not in step across bots", () => {
    const samples = Array.from({ length: 420 }, (_, i) => blinking(i / 100, 0));
    expect(samples.filter(Boolean).length).toBeGreaterThan(0);
    expect(samples.filter(Boolean).length).toBeLessThan(20);
    expect(blinking(0, 0)).not.toBe(blinking(0, 0.5));
  });
});
