// Fork: an interim resume. A code agent's assignment in its own thread is
// independent of its siblings: when it finishes while a sibling still runs,
// the requester resumes now with that result, waits again, and resumes once
// more when the rest is back. Siblings that are not independent keep
// upstream's rule (resume only when every child settled).
import { describe, expect, it } from "vitest";

import { composeResume } from "./envelope.ts";
import { checkInvariants } from "./invariants.ts";
import { Runtime } from "./runtime.ts";
import { openRuntimeStore } from "./store.ts";
import type { Assignment, EnqueueRequest, RunInput, RunResult, TurnRunner } from "./types.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function world() {
  const runs: Array<{ a: Assignment; input: RunInput }> = [];
  const held = new Map<string, (result: RunResult) => void>();
  const holdIds = new Set<string>();
  const runner: TurnRunner = {
    validate: () => undefined,
    canStart: () => true,
    run(a, input) {
      runs.push({ a, input });
      if (holdIds.has(a.id)) return new Promise<RunResult>(resolve => held.set(a.id, resolve));
      return Promise.resolve({ kind: "completed", text: `${a.assignee.botId} done` });
    },
    park: () => {},
    report: () => {},
    changed: () => {},
    names: a => ({ requester: a.requester.botId ?? "Wiebren", assignee: a.assignee.botId, person: "Wiebren" }),
  };
  let t = 1_000_000;
  const clock = { now: () => t, monotonic: () => t };
  const store = openRuntimeStore(":memory:");
  const runtime = new Runtime(store, runner, { clock, log: () => {} });
  runtime.open();
  const release = async (id: string) => {
    const resolve = held.get(id)!;
    held.delete(id);
    holdIds.delete(id);
    resolve({ kind: "completed", text: `${id} finished` });
    await flush();
  };
  const live = () => ({ running: new Set(held.keys()), parked: new Set<string>() });
  return { store, runtime, runs, holdIds, release, live, tick: () => { t += 1; runtime.tick(); } };
}

const toBot = (botId: string, parentId: string, independent: boolean): EnqueueRequest => ({
  parentId, origin: { kind: "person", source: "chat" },
  requester: { kind: "bot_turn", botId: "pm", threadId: "pm-chat" },
  assignee: { botId, destination: { kind: "work_thread", threadId: `${botId}-work` } },
  brief: `Build it, ${botId}`, levels: { own: "full" }, driverKind: "claudeAgent", ...(independent ? { independent } : {}),
});

const begin = (runtime: Runtime) => runtime.begin({
  origin: { kind: "person", source: "chat" }, requester: { kind: "person", threadId: "pm-chat" },
  assignee: { botId: "pm", destination: { kind: "standing_thread", threadId: "pm-chat" } }, brief: "Two cards", level: "full",
});

describe("fork: interim resume", () => {
  it("resumes the requester with an independent child's result while a sibling still runs, then once more at the end", async () => {
    const w = world();
    const root = begin(w.runtime);
    const fast = w.runtime.enqueue(toBot("code-a", root.id, true));
    const slow = w.runtime.enqueue(toBot("code-b", root.id, true));
    if (!fast.ok || !slow.ok) throw new Error("enqueue refused");
    w.holdIds.add(slow.assignment.id);
    w.runtime.end(root.id, { ok: true, text: "Handed out" });
    w.tick();
    await flush();
    expect(w.store.get(fast.assignment.id)?.status).toBe("completed");
    expect(w.store.get(slow.assignment.id)?.status).toBe("running");
    // the fast result is back: the PM resumes now, told one request still runs
    w.tick();
    const interim = w.runs.find(r => r.a.id === root.id && r.input.resumed);
    expect(interim?.input.settled?.map(s => s.id)).toEqual([fast.assignment.id]);
    expect(interim?.input.stillRunning).toBe(1);
    await flush();
    expect(w.store.get(root.id)).toMatchObject({ status: "waiting", interimFrom: [fast.assignment.id] });
    // the same result does not wake it twice
    w.tick();
    expect(w.runs.filter(r => r.a.id === root.id && r.input.resumed)).toHaveLength(1);
    await w.release(slow.assignment.id);
    w.tick();
    const final = w.runs.filter(r => r.a.id === root.id && r.input.resumed).at(-1)!;
    // every result rides along; the fast one is marked as already handed
    expect(final.input.settled?.map(s => s.id).sort()).toEqual([fast.assignment.id, slow.assignment.id].sort());
    expect(final.input.alreadyHanded).toEqual([fast.assignment.id]);
    expect(final.input.stillRunning).toBeUndefined();
    await flush();
    expect(w.store.get(root.id)?.status).toBe("completed");
    expect(checkInvariants(w.store, w.live())).toEqual([]);
  });

  it("keeps upstream's rule for siblings that are not independent: one resume when all are back", async () => {
    const w = world();
    const root = begin(w.runtime);
    const fast = w.runtime.enqueue(toBot("writer", root.id, false));
    const slow = w.runtime.enqueue(toBot("reviewer", root.id, false));
    if (!fast.ok || !slow.ok) throw new Error("enqueue refused");
    w.holdIds.add(slow.assignment.id);
    w.runtime.end(root.id, { ok: true, text: "Handed out" });
    w.tick();
    await flush();
    w.tick();
    expect(w.runs.filter(r => r.a.id === root.id && r.input.resumed)).toHaveLength(0);
    await w.release(slow.assignment.id);
    w.tick();
    expect(w.runs.filter(r => r.a.id === root.id && r.input.resumed)).toHaveLength(1);
  });

  it("an interim resume's text says the rest still runs and asks for an update, not a final answer", () => {
    const a = { brief: "Two cards", answer: undefined } as unknown as Assignment;
    const text = composeResume(a, { requester: "Jarvis", assignee: "PM", person: "Wiebren" }, ["report"], 2);
    expect(text).toContain("2 other request(s) are still running");
    expect(text).not.toContain("Your downstream room requests have settled");
  });
});
