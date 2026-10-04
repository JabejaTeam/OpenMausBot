import { describe, expect, it } from "vitest";
import { delegationLinks, linksOf, RECENT_HANDOFF_MS } from "./office-delegations";

const now = 1_000_000;

describe("delegationLinks", () => {
  it("links the opener to the bot while the opened thread is at work", () => {
    const links = delegationLinks([
      { id: "pm" },
      { id: "code", tasks: [{ threadId: "t", busy: true, openedBy: { botId: "pm", at: now - 60_000 } }] },
    ], now);
    expect(links).toEqual([{ id: "pm>code", from: "pm", to: "code", at: now - 60_000, active: true }]);
  });

  it("keeps a quick handoff for a moment after it is done, then drops it", () => {
    const bots = (at: number) => [{ id: "pm" }, { id: "code", tasks: [{ threadId: "t", openedBy: { botId: "pm", at } }] }];
    expect(delegationLinks(bots(now - 1000), now)).toHaveLength(1);
    expect(delegationLinks(bots(now - 1000), now)[0].active).toBe(false);
    expect(delegationLinks(bots(now - RECENT_HANDOFF_MS - 1), now)).toEqual([]);
  });

  it("counts waiting on you as still at work", () => {
    const links = delegationLinks([{ id: "pm" }, { id: "code", tasks: [{ threadId: "t", activity: "waiting-on-you", openedBy: { botId: "pm", at: 0 } }] }], now);
    expect(links[0].active).toBe(true);
  });

  it("merges threads of one pair, and skips self, routines and bots outside the office", () => {
    const links = delegationLinks([
      { id: "pm" },
      {
        id: "code",
        tasks: [
          { threadId: "a", busy: true, openedBy: { botId: "pm", at: now - 50 } },
          { threadId: "b", openedBy: { botId: "pm", at: now - 10 } },
          { threadId: "self", busy: true, openedBy: { botId: "code", at: now } },
          { threadId: "run", busy: true, routineRunId: "r", openedBy: { botId: "pm", at: now } },
          { threadId: "ghost", busy: true, openedBy: { botId: "hidden", at: now } },
        ],
      },
    ], now);
    expect(links).toEqual([{ id: "pm>code", from: "pm", to: "code", at: now - 10, active: true }]);
  });
});

describe("linksOf", () => {
  it("finds a bot's links either way", () => {
    const links = [
      { id: "a>b", from: "a", to: "b", at: 0, active: true },
      { id: "b>c", from: "b", to: "c", at: 0, active: true },
      { id: "d>e", from: "d", to: "e", at: 0, active: true },
    ];
    expect([...linksOf(links, "b")]).toEqual(["a>b", "b>c"]);
    expect(linksOf(links, null).size).toBe(0);
  });
});
