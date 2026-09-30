import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", () => ({ api }));

import { canHideBots, hiddenBotsForMe, setBotHiddenForMe, setPeopleForTest } from "./people";
import { shownForMe } from "./sidebar-layout";

describe("bots a person hides for themselves", () => {
  beforeEach(() => {
    api.mockReset();
    setPeopleForTest({ me: "p_me", hiddenBots: ["b1"] });
  });

  it("saves the whole list on the person's profile", async () => {
    api.mockResolvedValue({ hiddenBots: ["b1", "b2"] });
    await setBotHiddenForMe("b2", true);
    expect(api).toHaveBeenCalledWith("/api/people/me", { method: "PUT", body: JSON.stringify({ hiddenBots: ["b1", "b2"] }) });
    expect([...hiddenBotsForMe()]).toEqual(["b1", "b2"]);
    api.mockResolvedValue({ hiddenBots: ["b2"] });
    await setBotHiddenForMe("b1", false);
    expect([...hiddenBotsForMe()]).toEqual(["b2"]);
  });

  it("rolls back when the save fails", async () => {
    api.mockRejectedValue(new Error("offline"));
    await expect(setBotHiddenForMe("b2", true)).rejects.toThrow("offline");
    expect([...hiddenBotsForMe()]).toEqual(["b1"]);
  });

  it("is only offered to a signed-in person", () => {
    expect(canHideBots()).toBe(true);
    setPeopleForTest({});
    expect(canHideBots()).toBe(false);
  });

  it("keeps a hidden bot out of the sidebar unless a search names it", () => {
    const hidden = new Set(["b1"]);
    expect(shownForMe({ id: "b1" }, hidden, "")).toBe(false);
    expect(shownForMe({ id: "b2" }, hidden, "")).toBe(true);
    expect(shownForMe({ id: "b1" }, hidden, "wren")).toBe(true);
  });
});
