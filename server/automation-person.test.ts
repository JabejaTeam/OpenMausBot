import { describe, expect, it } from "vitest";
import { automationMcpPerson } from "./automation-person.ts";

describe("automationMcpPerson", () => {
  it("gives the owner's routine run the owner's own servers", () => {
    expect(automationMcpPerson("schedule", "p_owner", "p_owner")).toBe("p_owner");
    expect(automationMcpPerson("manual", "p_owner", "p_owner")).toBe("p_owner");
    expect(automationMcpPerson("startup", "p_owner", "p_owner")).toBe("p_owner");
  });

  it("keeps a routine made for someone else on the shared values", () => {
    expect(automationMcpPerson("schedule", "p_member", "p_owner")).toBeUndefined();
  });

  it("never gives a webhook run anyone's own servers", () => {
    expect(automationMcpPerson("webhook", "p_owner", "p_owner")).toBeUndefined();
  });

  it("gives nothing without a known run person or owner", () => {
    expect(automationMcpPerson("schedule", undefined, "p_owner")).toBeUndefined();
    expect(automationMcpPerson("schedule", undefined, undefined)).toBeUndefined();
  });
});
