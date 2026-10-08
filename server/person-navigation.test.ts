import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { MAX_VISITS_PER_PERSON, PersonNavigation } from "./person-navigation.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "omb-nav-")), "person-navigation.json");

describe("PersonNavigation", () => {
  it("remembers per person and per agent the conversation and when", () => {
    const nav = new PersonNavigation(file());
    expect(nav.remember("p_ada", "bot-1", "thread-a", 10)).toBe(true);
    nav.remember("p_ada", "bot-1", "thread-b", 20);
    nav.remember("p_bob", "bot-1", "thread-c", 30);
    expect(nav.lastThread("p_ada", "bot-1")).toBe("thread-b");
    expect(nav.visits("p_ada")).toEqual({ "bot-1": { threadId: "thread-b", at: 20 } });
    expect(nav.lastThread("p_bob", "bot-1")).toBe("thread-c");
    expect(nav.lastThread("p_cy", "bot-1")).toBeUndefined();
  });

  it("refuses ids that are not ids", () => {
    const nav = new PersonNavigation(file());
    expect(nav.remember("p_ada", "../bot", "thread-a")).toBe(false);
    expect(nav.remember("p ada", "bot-1", "thread-a")).toBe(false);
    expect(nav.visits("p_ada")).toEqual({});
  });

  it("keeps its file private and survives a restart, dropping what is malformed", () => {
    const path = file();
    const nav = new PersonNavigation(path);
    nav.remember("p_ada", "bot-1", "thread-a", 10);
    nav.flush();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(new PersonNavigation(path).visits("p_ada")).toEqual({ "bot-1": { threadId: "thread-a", at: 10 } });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ p_ada: { "bot-1": { threadId: "thread-a", at: 10 } } });
  });

  it("forgets the oldest agents past its limit", () => {
    const nav = new PersonNavigation(file());
    for (let i = 0; i <= MAX_VISITS_PER_PERSON; i++) nav.remember("p_ada", `bot-${i}`, "thread", i);
    expect(Object.keys(nav.visits("p_ada"))).toHaveLength(MAX_VISITS_PER_PERSON);
    expect(nav.lastThread("p_ada", "bot-0")).toBeUndefined();
  });
});
