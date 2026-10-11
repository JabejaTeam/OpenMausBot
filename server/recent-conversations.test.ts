// Fork: the team-wide Recent work brief — which conversations are in scope,
// that access and routines are respected, and how a line reads.
import { describe, expect, it } from "vitest";

import {
  askerName,
  conversationLines,
  conversationThreads,
  recentConversationsPrompt,
  RECENT_CONVERSATIONS_MAX_CHARS,
  scopeBots,
  type ScopeBot,
} from "./recent-conversations.ts";
import type { RecentWorkStore } from "./recent-work.ts";
import type { TaskRecord } from "./store.ts";

const task = (threadId: string, title: string, extra: Partial<TaskRecord> = {}): TaskRecord =>
  ({ threadId, title, createdAt: 1, resumeCursors: {}, ...extra } as TaskRecord);
const bot = (id: string, name: string, section: string | undefined, kind: string | undefined, tasks: TaskRecord[] = [], extra: Partial<ScopeBot> = {}): ScopeBot =>
  ({ id, name, section, kind, threadId: `${id}-main`, tasks, ...extra } as ScopeBot);

const pm = bot("pm", "Ripal PM", "Ripal", "pm", [
  task("pm-today", "Miguel mails"),
  task("pm-dream", "Nachtelijke droom", { routineRunId: "run-1" }),
  task("pm-joren-private", "Joren alone"),
]);
const code = bot("code", "Ripal Code", "Ripal", "code", [task("code-work", "build")]);
const helper = bot("helper", "Warehouse", "Ripal", undefined, [task("helper-t", "pallets")]);
const other = bot("boa", "BOA PM", "BOA", "pm", [task("boa-t", "Plaud")]);
const personal = bot("jexen", "Jexen", undefined, undefined, [task("jexen-t", "academy")], { visibility: { people: ["joren@jabeja.be"], private: true } });
const chief = bot("jarvis", "Jarvis", undefined, undefined, [], { visibility: "admins", managedSections: ["Ripal", "BOA"] });
const loose = bot("mini", "Mac mini", undefined, undefined, [], { visibility: "admins" });
const bots = [pm, code, helper, other, personal, chief, loose];
const store: RecentWorkStore = { groups: [], taskByThread: () => undefined };
const all = () => true;

describe("scopeBots", () => {
  it("is only the bot itself when no person started the turn", () => {
    expect(scopeBots(pm, bots, false).map((b) => b.id)).toEqual(["pm"]);
  });
  it("is the bot's section, without code bots, for a team bot", () => {
    expect(scopeBots(pm, bots, true).map((b) => b.id)).toEqual(["pm", "helper"]);
  });
  it("spans the sections a Chief manages", () => {
    expect(scopeBots(chief, bots, true).map((b) => b.id)).toEqual(["jarvis", "pm", "helper", "boa"]);
  });
  it("is every non-code bot for a private personal agent without sections (access decides the rest)", () => {
    expect(scopeBots(personal, bots, true).map((b) => b.id)).toEqual(["jexen", "pm", "helper", "boa", "jarvis", "mini"]);
  });
  it("stays own-only for any other bot without a section", () => {
    expect(scopeBots(loose, bots, true).map((b) => b.id)).toEqual(["mini"]);
  });
});

describe("conversationThreads", () => {
  it("lists own and teammates' conversations, never this one, routine runs or code work", () => {
    const threads = conversationThreads(pm, bots, store, { widen: true, canSee: all, currentThreadId: "pm-today", userName: "Wiebren" });
    expect(threads.map((t) => t.threadId)).toEqual(["pm-main", "pm-joren-private", "helper-main", "helper-t"]);
    expect(threads.find((t) => t.threadId === "helper-t")).toEqual({ threadId: "helper-t", bot: "Warehouse", where: "1:1", title: "pallets" });
  });
  it("shows only what the person may see (thread-access SSOT decides)", () => {
    const canSee = (id: string) => id !== "pm-joren-private";
    const threads = conversationThreads(pm, bots, store, { widen: true, canSee, userName: "Wiebren" });
    expect(threads.map((t) => t.threadId)).not.toContain("pm-joren-private");
    expect(threads.map((t) => t.threadId)).toContain("pm-today");
  });
  it("names a room the way upstream does", () => {
    const withRoom: RecentWorkStore = { groups: [{ id: "g", threadId: "room", name: "Ops", memberIds: ["pm"] } as RecentWorkStore["groups"][number]], taskByThread: () => undefined };
    const threads = conversationThreads(pm, bots, withRoom, { widen: false, canSee: all, userName: "Wiebren" });
    expect(threads.find((t) => t.threadId === "room")).toEqual({ threadId: "room", where: 'room "Ops"', title: null });
  });
});

describe("conversationLines", () => {
  it("keeps exchange order, drops threads out of scope and empty exchanges", () => {
    const threads = conversationThreads(pm, bots, store, { widen: true, canSee: all, userName: "W" });
    const lines = conversationLines(threads, [
      { threadId: "helper-t", at: 30, asked: "how many pallets?", askedBy: "joren@jabeja.be", said: "42" },
      { threadId: "boa-t", at: 20, said: "not in scope" },
      { threadId: "pm-today", at: 10 },
    ]);
    expect(lines).toEqual([{ threadId: "helper-t", at: 30, asked: "how many pallets?", askedBy: "joren@jabeja.be", said: "42", bot: "Warehouse", where: "1:1", title: "pallets" }]);
  });
});

describe("recentConversationsPrompt", () => {
  const now = new Date(2026, 9, 10, 19, 16).getTime();
  it("is empty without lines", () => {
    expect(recentConversationsPrompt([], now)).toBe("");
  });
  it("names when, which bot, what was asked by whom and the last answer", () => {
    const text = recentConversationsPrompt([
      { threadId: "a", at: new Date(2026, 9, 10, 18, 14).getTime(), where: "1:1", title: "Miguel mails", asked: "zet dit als taak maandag", askedBy: "wiebren@jabeja.be", said: "Taak staat op maandag 12 oktober." },
      { threadId: "b", at: new Date(2026, 9, 9, 9, 0).getTime(), bot: "Warehouse", where: "1:1", title: null, said: "Done." },
    ], now);
    expect(text).toContain('\n- today 18:14 · you · "Miguel mails" · Wiebren asked: "zet dit als taak maandag" · last answer: "Taak staat op maandag 12 oktober."');
    expect(text).toContain("\n- yesterday 09:00 · Warehouse · last answer: \"Done.\"");
  });
  it("stays inside its budget", () => {
    const long = "x".repeat(500);
    const lines = Array.from({ length: 10 }, (_, i) => ({ threadId: `t${i}`, at: now - i, where: "1:1", title: long, asked: long, said: long }));
    const text = recentConversationsPrompt(lines, now);
    expect(text.length).toBeLessThan(RECENT_CONVERSATIONS_MAX_CHARS + 600);
  });
});

describe("askerName", () => {
  it("turns a sign-in email into a first name", () => {
    expect(askerName("joren@jabeja.be")).toBe("Joren");
    expect(askerName(undefined)).toBe("someone");
  });
});
