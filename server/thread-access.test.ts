// Jabeja fork: every conversation is private (server/thread-access.ts).
// Its person, whom they shared it with and admins see it; nobody else. Work
// a bot opened on someone's request is that person's; what one conversation
// may carry into another (briefs, recall, search) ignores the admin view.
import { describe, expect, it } from "vitest";

import { conversationThreads, type ScopeBot } from "./recent-conversations.ts";
import type { RecentWorkStore } from "./recent-work.ts";
import type { TaskRecord } from "./store.ts";
import { latestThreadFor, threadAudience, threadFeeds, threadRole, type ThreadAccessRecords } from "./thread-access.ts";

const OWNER = "p_owner_______________1";
const MIGUEL = "p_miguel______________1";
const LOGISTICS = "p_logistics___________1";
const JOREN = "p_joren_______________1";

function records(starters: Record<string, string>, shares: Record<string, string[]> = {}): ThreadAccessRecords {
  return { starter: (id) => starters[id], shares: (id) => shares[id] ?? [], owner: () => OWNER };
}

describe("threadRole", () => {
  const r = records({ miguel: MIGUEL, shared: MIGUEL, work: MIGUEL }, { shared: [JOREN] });
  it("gives the thread to its starter", () => {
    expect(threadRole(MIGUEL, "miguel", r)).toBe("own");
  });
  it("hides it from another member, also one who can see the bot", () => {
    expect(threadRole(LOGISTICS, "miguel", r)).toBeUndefined();
    expect(threadRole(LOGISTICS, "work", r)).toBeUndefined();
  });
  it("shows it to every admin", () => {
    expect(threadRole(LOGISTICS, "miguel", r, true)).toBe("team");
    expect(threadRole(JOREN, "miguel", r, true)).toBe("team");
  });
  it("shows it to whom it was shared with, one by one", () => {
    expect(threadRole(JOREN, "shared", r)).toBe("shared");
    expect(threadRole(LOGISTICS, "shared", r)).toBeUndefined();
  });
  it("gives a thread nobody was recorded for to the install owner", () => {
    expect(threadRole(OWNER, "unrecorded", r)).toBe("own");
    expect(threadRole(MIGUEL, "unrecorded", r)).toBeUndefined();
  });
  it("names nobody without a person", () => {
    expect(threadRole(undefined, "miguel", r, true)).toBeUndefined();
  });
});

describe("threadFeeds", () => {
  const r = records({ miguel: MIGUEL, miguel2: MIGUEL, logistics: LOGISTICS, shared: LOGISTICS, joren: JOREN }, { shared: [MIGUEL], joren: [MIGUEL] });
  it("lets a person's own conversations feed each other", () => {
    expect(threadFeeds("miguel2", "miguel", r)).toBe(true);
    expect(threadFeeds("shared", "miguel", r)).toBe(true);
  });
  it("never carries someone else's conversation in", () => {
    expect(threadFeeds("logistics", "miguel", r)).toBe(false);
    expect(threadFeeds("miguel", "logistics", r)).toBe(false);
  });
  it("ignores the admin view: the owner's thread gets no one else's", () => {
    expect(threadFeeds("miguel", "unrecorded", r)).toBe(false);
  });
  it("feeds a shared conversation only what everyone in it may open", () => {
    expect(threadAudience("joren", r)).toEqual([JOREN, MIGUEL]);
    expect(threadFeeds("miguel", "joren", r)).toBe(false); // Joren may not open Miguel's
    expect(threadFeeds("joren", "joren", r)).toBe(true);
  });
});

describe("the Recent work brief", () => {
  const task = (threadId: string, title: string): TaskRecord => ({ threadId, title, createdAt: 1, resumeCursors: {} } as TaskRecord);
  const logistiek = { id: "log", name: "Logistiek", section: "Ripal", kind: undefined, threadId: "log-main",
    tasks: [task("log-main", "main"), task("work-miguel", "@Manager · work"), task("log-own", "pallets")] } as ScopeBot;
  const store: RecentWorkStore = { groups: [], taskByThread: () => undefined };
  const r = records({ "log-main": LOGISTICS, "log-own": LOGISTICS, "work-miguel": MIGUEL, "log-new": LOGISTICS });
  it("leaves out work done for someone else on the same bot", () => {
    const threads = conversationThreads(logistiek, [logistiek], store, {
      widen: true, canSee: (id) => threadFeeds(id, "log-new", r), currentThreadId: "log-new", userName: "x" });
    expect(threads.map((t) => t.threadId)).toEqual(["log-main", "log-own"]);
  });
  it("gives Miguel's work thread only Miguel's", () => {
    const threads = conversationThreads(logistiek, [logistiek], store, {
      widen: false, canSee: (id) => threadFeeds(id, "work-miguel", r), currentThreadId: "work-miguel", userName: "x" });
    expect(threads).toEqual([]);
  });
});

describe("latestThreadFor", () => {
  it("opens the newest of the person's own, never a routine run", () => {
    const tasks = [{ threadId: "a", updatedAt: 1 }, { threadId: "b", updatedAt: 3 }, { threadId: "c", updatedAt: 5, routineRunId: "r" }];
    expect(latestThreadFor(tasks, (id) => id !== "x")?.threadId).toBe("b");
  });
});
