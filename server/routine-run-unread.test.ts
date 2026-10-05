import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";

// Fork test of an upstream rule (taskCountsAsBotUnread): a routine's own
// execution never makes its bot unread — its result is unread in the
// conversation that asked for it. An external context update once marked
// Jarvis's daily intake run unread and the sidebar showed nothing to read.
beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });
const fresh = () => new Store(() => ({ instanceId: "personal", model: "claude-sonnet-5" }));

it("never makes the bot unread for a routine execution, whoever marks it", () => {
  const store = fresh();
  const bot = store.createBot({}, { seedMessages: false });
  const run = store.createTask(bot.id, "Daily intake")!;
  store.patchTask(bot.id, run.threadId, { routineRunId: "run-1" });
  store.patchTask(bot.id, run.threadId, { unread: true });
  expect(store.bot(bot.id)?.unread).toBe(false);
});

it("still lets a conversation be unread, and a run handed back to the person", () => {
  const store = fresh();
  const bot = store.createBot({}, { seedMessages: false });
  const chat = store.createTask(bot.id, "Chat")!;
  store.patchTask(bot.id, chat.threadId, { unread: true });
  expect(store.bot(bot.id)?.unread).toBe(true);
  // no reporting thread: the run becomes an ordinary conversation, unread
  const run = store.createTask(bot.id, "Run")!;
  store.patchTask(bot.id, run.threadId, { routineRunId: "run-2" });
  store.patchTask(bot.id, run.threadId, { routineRunId: undefined, unread: true });
  expect(store.taskByThread(bot.id, run.threadId)?.unread).toBe(true);
});

it("leaves the bot read on load when a routine execution was saved unread", () => {
  const store = fresh();
  const bot = store.createBot({}, { seedMessages: false });
  const run = store.createTask(bot.id, "Daily intake")!;
  store.patchTask(bot.id, run.threadId, { routineRunId: "run-3" });
  // what an older server left on disk
  Object.assign(store.taskByThread(bot.id, run.threadId)!, { unread: true });
  Object.assign(store.bot(bot.id)!, { unread: true });
  (store as unknown as { saveBots(): void }).saveBots();
  const reloaded = fresh();
  expect(reloaded.bot(bot.id)?.unread).toBe(false);
});
