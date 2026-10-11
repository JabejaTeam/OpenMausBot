import { describe, expect, it } from "vitest";
import { notifyReaches } from "./notify-audience.ts";

describe("notifyReaches", () => {
  const forWiebren = { kind: "notify", forPerson: "wiebren@jabeja.be" };

  it("rings only for the person whose message started the turn", () => {
    expect(notifyReaches(forWiebren, "wiebren@jabeja.be")).toBe(true);
    expect(notifyReaches(forWiebren, "joren@jabeja.be")).toBe(false);
    expect(notifyReaches(forWiebren, undefined)).toBe(false);
  });

  it("keeps the old rule when nobody started it by a message", () => {
    expect(notifyReaches({ kind: "notify" }, "joren@jabeja.be")).toBe(true);
    expect(notifyReaches({ kind: "notify", forPerson: "" }, undefined)).toBe(true);
  });

  it("leaves every other frame alone", () => {
    expect(notifyReaches({ kind: "message", forPerson: "wiebren@jabeja.be" }, "joren@jabeja.be")).toBe(true);
  });
});
