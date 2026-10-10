import { describe, expect, it } from "vitest";

import { lastActivityForMe } from "./thread-channel";

describe("lastActivityForMe", () => {
  it("is the newest message in a conversation of the viewer's, whoever wrote it", () => {
    expect(lastActivityForMe({ tasks: [
      { updatedAt: 5, access: "own" },
      { updatedAt: 9, access: "shared" },
      { updatedAt: 7, access: "own" },
    ] })).toBe(9);
  });

  it("leaves out a teammate's conversation, a thread a bot opened and a routine run", () => {
    expect(lastActivityForMe({ tasks: [
      { updatedAt: 3, access: "own" },
      { updatedAt: 50, access: "team" },
      { updatedAt: 60, access: "own", openedBy: { botId: "pm", name: "PM", at: 1, kind: "work" } },
      { updatedAt: 70, access: "own", routineRunId: "r1" },
    ] })).toBe(3);
  });

  it("counts every conversation where threads are not split per person", () => {
    expect(lastActivityForMe({ tasks: [{ updatedAt: 4 }, { updatedAt: 8 }] })).toBe(8);
  });

  it("is 0 without a conversation", () => {
    expect(lastActivityForMe({})).toBe(0);
    expect(lastActivityForMe({ tasks: [{ updatedAt: 9, access: "team" }] })).toBe(0);
  });
});
