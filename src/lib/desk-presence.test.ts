import { describe, expect, it } from "vitest";

import { DESK_BEAT_MS, deskBeatDue } from "./desk-presence";

describe("deskBeatDue", () => {
  it("speaks up only for a focused window, at most once per beat", () => {
    expect(deskBeatDue(-Infinity, 0, true)).toBe(true);
    expect(deskBeatDue(-Infinity, 0, false)).toBe(false);
    expect(deskBeatDue(1_000, 1_000 + DESK_BEAT_MS - 1, true)).toBe(false);
    expect(deskBeatDue(1_000, 1_000 + DESK_BEAT_MS, true)).toBe(true);
  });
});
