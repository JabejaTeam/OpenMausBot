import { describe, expect, it } from "vitest";
import { groupThreadsByDate, threadDateGroupKey } from "./thread-date-groups";

const now = new Date(2026, 9, 8, 21, 0).getTime();
const at = (month: number, day: number, hour = 12) => new Date(2026, month, day, hour).getTime();

describe("threadDateGroupKey", () => {
  it("files by calendar day, not by 24-hour spans", () => {
    expect(threadDateGroupKey(at(9, 8, 0), now)).toBe("today");
    expect(threadDateGroupKey(at(9, 7, 23), now)).toBe("yesterday");
    expect(threadDateGroupKey(at(9, 6), now)).toBe("week");
    expect(threadDateGroupKey(at(9, 1), now)).toBe("week");
    expect(threadDateGroupKey(at(8, 30), now)).toBe("month");
    expect(threadDateGroupKey(at(8, 7), now)).toBe("m:2026-8");
    expect(threadDateGroupKey(at(9, 8), now, true)).toBe("pinned");
  });
});

describe("groupThreadsByDate", () => {
  it("keeps the list's order and starts a group where the date changes", () => {
    const tasks = [
      { id: "pin", pinned: true, at: at(7, 1) },
      { id: "a", at: at(9, 8, 20) },
      { id: "b", at: at(9, 8, 9) },
      { id: "c", at: at(9, 7) },
      { id: "d", at: at(9, 3) },
      { id: "e", at: at(6, 2) },
    ];
    const groups = groupThreadsByDate(tasks, (task) => task.at, now, "en");
    expect(groups.map((group) => [group.key, group.tasks.map((task) => task.id)])).toEqual([
      ["pinned", ["pin"]], ["today", ["a", "b"]], ["yesterday", ["c"]], ["week", ["d"]], ["m:2026-6", ["e"]],
    ]);
    expect(groups[4].label).toBe("July");
  });
});
