import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { Store } from "./store.ts";

// Fork: a routine's own execution thread is never unread — its result is
// unread in the conversation that asked for it (index.ts says so where turns
// settle). Every writer used to be trusted to remember that; one didn't (an
// external context update), and the bot showed "unread" with nothing to read.
beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });
const fresh = () => new Store(() => ({ instanceId: "personal", model: "claude-sonnet-5" }));

it("keeps a routine execution read, whoever marks it unread", () => {
  const store = fresh();
  const bot = store.createBot({}, { seedMessages: false });
  const run = store.createTask(bot.id, "Daily intake")!;
  store.patchTask(bot.id, run.threadId, { routineRunId: "run-1" });
  store.patchTask(bot.id, run.threadId, { unread: true });
  expect(store.taskByThread(bot.id, run.threadId)?.unread).toBe(false);
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

it("clears an unread routine execution saved before the rule, on load", () => {
  const store = fresh();
  const bot = store.createBot({}, { seedMessages: false });
  const run = store.createTask(bot.id, "Daily intake")!;
  store.patchTask(bot.id, run.threadId, { routineRunId: "run-3" });
  // what an older server left on disk
  Object.assign(store.taskByThread(bot.id, run.threadId)!, { unread: true });
  Object.assign(store.bot(bot.id)!, { unread: true });
  (store as unknown as { saveBots(): void }).saveBots();
  const reloaded = fresh();
  expect(reloaded.taskByThread(bot.id, run.threadId)?.unread).toBe(false);
  expect(reloaded.bot(bot.id)?.unread).toBe(false);
});
