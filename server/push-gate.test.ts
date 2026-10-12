import { describe, expect, it } from "vitest";

import { DESK_ACTIVE_MS, PUSH_DELAY_MS, PushGate } from "./push-gate.ts";
import type { Notification } from "../shared/notification.ts";

const note = (threadId = "thread-a", body = "Klaar."): Notification =>
  ({ kind: "done", botId: "bot-1", botName: "Ripal PM", threadId, title: "Ripal PM", body });

/** A gate on a hand-driven clock: `advance` runs the timers that fall due. */
function harness() {
  let now = 1_000_000;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let nextId = 0;
  const pushed: [string, string][] = [];
  const cleared: [string, string][] = [];
  const gate = new PushGate({
    push: async (person, n) => { pushed.push([person, n.body]); return 1; },
    clear: async (person, threadId) => { cleared.push([person, threadId]); },
    now: () => now,
    setTimer: (run, ms) => { const id = nextId++; timers.push({ at: now + ms, run, id }); return id; },
    clearTimer: (id) => { timers = timers.filter((t) => t.id !== id); },
  });
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers = timers.filter((t) => t !== next);
      now = next.at;
      next.run();
      await Promise.resolve();
    }
    now = until;
    await Promise.resolve();
  };
  return { gate, pushed, cleared, advance };
}

describe("PushGate", () => {
  it("pushes after a short wait when the person is at no desk", async () => {
    const { gate, pushed, advance } = harness();
    gate.notify("p_ada", note());
    await advance(PUSH_DELAY_MS - 1);
    expect(pushed).toEqual([]);
    await advance(1);
    expect(pushed).toEqual([["p_ada", "Klaar."]]);
  });

  it("stays quiet while the person works at a desk, and pushes once they left it", async () => {
    const { gate, pushed, advance } = harness();
    gate.noteDesk("p_ada");
    gate.notify("p_ada", note());
    await advance(PUSH_DELAY_MS);
    expect(pushed).toEqual([]);
    await advance(DESK_ACTIVE_MS - PUSH_DELAY_MS - 1);
    gate.noteDesk("p_ada"); // still working
    await advance(DESK_ACTIVE_MS - 1);
    expect(pushed).toEqual([]);
    await advance(1);
    expect(pushed).toEqual([["p_ada", "Klaar."]]);
  });

  it("never pushes what the person read in the meantime", async () => {
    const { gate, pushed, cleared, advance } = harness();
    gate.noteDesk("p_ada");
    gate.notify("p_ada", note());
    gate.read("p_ada", "thread-a");
    await advance(DESK_ACTIVE_MS * 2);
    expect(pushed).toEqual([]);
    expect(cleared).toEqual([]); // nothing on the phone to clear
  });

  it("clears a delivered push from the phone once it is read, only once", async () => {
    const { gate, cleared, advance } = harness();
    gate.notify("p_ada", note());
    await advance(PUSH_DELAY_MS);
    gate.read("p_ada", "thread-a");
    gate.read("p_ada", "thread-a");
    expect(cleared).toEqual([["p_ada", "thread-a"]]);
  });

  it("sends one push per conversation, with its newest text", async () => {
    const { gate, pushed, advance } = harness();
    gate.notify("p_ada", note("thread-a", "eerste"));
    gate.notify("p_ada", note("thread-a", "tweede"));
    gate.notify("p_ada", note("thread-b", "ander"));
    await advance(PUSH_DELAY_MS);
    expect(pushed.sort()).toEqual([["p_ada", "ander"], ["p_ada", "tweede"]]);
  });

  it("keeps people apart: one's desk or read does not touch another's push", async () => {
    const { gate, pushed, advance } = harness();
    gate.noteDesk("p_bob");
    gate.notify("p_ada", note());
    gate.read("p_bob", "thread-a");
    gate.notify(undefined, note("thread-c"));
    await advance(PUSH_DELAY_MS);
    expect(pushed).toEqual([["p_ada", "Klaar."]]);
  });
});
