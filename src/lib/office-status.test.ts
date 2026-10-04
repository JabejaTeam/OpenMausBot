import { describe, expect, it } from "vitest";
import { attentionThreadId, botStatus, focusTask, nextNeedingYou, statusGroups, type StatusBot } from "./office-status";

const bot = (id: string, patch: Partial<StatusBot> = {}): StatusBot => ({ id, threadId: `${id}-current`, ...patch });

describe("botStatus", () => {
  it("puts waiting on you before working before unread", () => {
    expect(botStatus(bot("a", { busy: true, unread: true, tasks: [{ threadId: "t", createdAt: 1, activity: "waiting-on-you" }] }))).toBe("waiting");
    expect(botStatus(bot("b", { unread: true, tasks: [{ threadId: "t", createdAt: 1, busy: true }] }))).toBe("working");
    expect(botStatus(bot("c", { tasks: [{ threadId: "t", createdAt: 1, unread: true }] }))).toBe("unread");
    expect(botStatus(bot("d"))).toBe("idle");
  });

  it("ignores routine runs", () => {
    expect(botStatus(bot("r", { tasks: [{ threadId: "run", createdAt: 1, routineRunId: "x", activity: "waiting-on-you" }] }))).toBe("idle");
  });
});

describe("attentionThreadId", () => {
  it("opens the thread that waits on you, not the newest one", () => {
    expect(attentionThreadId(bot("a", {
      tasks: [
        { threadId: "waits", createdAt: 1, updatedAt: 2, activity: "waiting-on-you" },
        { threadId: "newer", createdAt: 3, updatedAt: 9 },
      ],
    }))).toBe("waits");
  });

  it("then the newest unread thread, then the newest conversation", () => {
    expect(attentionThreadId(bot("a", {
      tasks: [
        { threadId: "old-unread", createdAt: 1, unread: true },
        { threadId: "new-unread", createdAt: 5, unread: true },
        { threadId: "newest", createdAt: 9 },
      ],
    }))).toBe("new-unread");
    expect(attentionThreadId(bot("b", { tasks: [{ threadId: "x", createdAt: 1 }, { threadId: "y", createdAt: 2 }] }))).toBe("y");
  });

  it("opens the thread being worked on before an unread one", () => {
    expect(attentionThreadId(bot("a", {
      tasks: [
        { threadId: "busy", createdAt: 1, busy: true },
        { threadId: "unread", createdAt: 9, unread: true },
      ],
    }))).toBe("busy");
  });

  it("uses the open thread when only the bot says it waits", () => {
    expect(attentionThreadId(bot("a", { activity: "waiting-on-you" }))).toBe("a-current");
  });
});

describe("statusGroups", () => {
  it("files each bot once, keeping the given order", () => {
    const groups = statusGroups([bot("w1", { activity: "waiting-on-you" }), bot("k", { busy: true }), bot("w2", { activity: "waiting-on-you", busy: true }), bot("i")]);
    expect(groups.waiting.map((b) => b.id)).toEqual(["w1", "w2"]);
    expect(groups.working.map((b) => b.id)).toEqual(["k"]);
    expect(groups.unread).toEqual([]);
  });
});

describe("focusTask", () => {
  it("names the thread a click opens, with its status", () => {
    expect(focusTask(bot("a", { tasks: [{ threadId: "w", createdAt: 1, activity: "waiting-on-you", title: "Q3 invoices" }, { threadId: "n", createdAt: 5, title: "Newer" }] }))).toEqual({ status: "waiting", title: "Q3 invoices" });
    expect(focusTask(bot("b", { busy: true, threadId: "cur", tasks: [{ threadId: "cur", createdAt: 1, busy: true, title: "Roadmap #42" }] }))).toEqual({ status: "working", title: "Roadmap #42" });
    expect(focusTask(bot("c"))).toEqual({ status: "idle", title: null });
  });
});

describe("nextNeedingYou", () => {
  const bots = [bot("w1", { activity: "waiting-on-you" }), bot("u1", { unread: true }), bot("k", { busy: true }), bot("w2", { activity: "waiting-on-you" })];
  it("goes waiting first, then unread, after the current one, wrapping round", () => {
    expect(nextNeedingYou(bots, null)?.bot.id).toBe("w1");
    expect(nextNeedingYou(bots, "w1")?.bot.id).toBe("w2");
    expect(nextNeedingYou(bots, "w2")?.bot.id).toBe("u1");
    expect(nextNeedingYou(bots, "u1")?.bot.id).toBe("w1");
    expect(nextNeedingYou(bots, "k")).toEqual({ bot: bots[0], count: 3 });
  });
  it("is null when nobody else needs you", () => {
    expect(nextNeedingYou([bot("w", { activity: "waiting-on-you" }), bot("i")], "w")).toBeNull();
  });
});
