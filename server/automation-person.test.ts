import { describe, expect, it } from "vitest";
import { automationMcpPerson } from "./automation-person.ts";

describe("automationMcpPerson", () => {
  it("gives the owner's routine run the owner's own servers", () => {
    expect(automationMcpPerson("schedule", "p_owner")).toBe("p_owner");
    expect(automationMcpPerson("manual", "p_owner")).toBe("p_owner");
    expect(automationMcpPerson("startup", "p_owner")).toBe("p_owner");
  });

  it("gives a member's routine run that member's own servers", () => {
    expect(automationMcpPerson("schedule", "p_member")).toBe("p_member");
  });

  it("never gives a webhook run anyone's own servers", () => {
    expect(automationMcpPerson("webhook", "p_owner")).toBeUndefined();
  });

  it("gives nothing without a known run person", () => {
    expect(automationMcpPerson("schedule", undefined)).toBeUndefined();
  });
});
