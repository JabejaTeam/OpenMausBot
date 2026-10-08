import { describe, expect, it } from "vitest";
import { lastVisited } from "./navigation-memory";

describe("lastVisited", () => {
  const team = [{ id: "pm" }, { id: "seo" }, { id: "code" }];
  it("is the member this person was on last", () => {
    expect(lastVisited(team, { pm: { threadId: "a", at: 5 }, code: { threadId: "b", at: 9 }, other: { threadId: "c", at: 99 } })?.id).toBe("code");
  });
  it("is nobody before any visit, so the team opens on its Manager", () => {
    expect(lastVisited(team, {})).toBeUndefined();
  });
});
