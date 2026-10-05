import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import {
  KIND_INSTRUCTIONS_FILE, KIND_INSTRUCTIONS_MAX_BYTES, kindInstructionsSystemPrompt, kindTakesTeamKnowledge, readKindInstructions, writeKindInstructions,
} from "./kind-instructions.ts";
import { clientBotPatchViolation } from "./request-auth.ts";
import { Store } from "./store.ts";

describe("workspace rules by kind of bot", () => {
  beforeEach(() => rmSync(KIND_INSTRUCTIONS_FILE, { force: true }));

  it("gives every bot the shared rules and only code agents the code rules", () => {
    expect(kindInstructionsSystemPrompt()).toBe("");
    writeKindInstructions("everyone", "Expect only the edit from a code agent.");
    writeKindInstructions("code", "Surgical changes only.");
    const plain = kindInstructionsSystemPrompt();
    const code = kindInstructionsSystemPrompt("code");
    expect(plain).toContain("Expect only the edit from a code agent.");
    expect(plain).not.toContain("Surgical changes only.");
    expect(code).toContain("Expect only the edit from a code agent.");
    expect(code).toContain("Surgical changes only.");
    expect(code).toMatch(/win over any conflicting working rule[\s\S]*AGENTS\.md/);
  });

  it("gives project managers their own rules and not the code rules", () => {
    writeKindInstructions("code", "Surgical changes only.");
    writeKindInstructions("pm", "Hand code questions to the code agent.");
    const pm = kindInstructionsSystemPrompt("pm");
    expect(pm).toContain("client project managers");
    expect(pm).toContain("Hand code questions to the code agent.");
    expect(pm).not.toContain("Surgical changes only.");
    expect(kindInstructionsSystemPrompt("code")).not.toContain("Hand code questions to the code agent.");
  });

  it("gives test agents their own rules and not the pm rules", () => {
    writeKindInstructions("pm", "Hand code questions to the code agent.");
    writeKindInstructions("test", "Test every card on staging.");
    const tester = kindInstructionsSystemPrompt("test");
    expect(tester).toContain("test agents");
    expect(tester).toContain("Test every card on staging.");
    expect(tester).not.toContain("Hand code questions to the code agent.");
    expect(kindInstructionsSystemPrompt("pm")).not.toContain("Test every card on staging.");
  });

  it("gives the others rules and the team context to every bot except code agents", () => {
    writeKindInstructions("others", "Make a test card per card.");
    expect(kindInstructionsSystemPrompt()).toContain("Make a test card per card.");
    expect(kindInstructionsSystemPrompt("pm")).toContain("Make a test card per card.");
    expect(kindInstructionsSystemPrompt("code")).not.toContain("Make a test card per card.");
    expect(kindTakesTeamKnowledge("code")).toBe(false);
    expect(kindTakesTeamKnowledge("pm")).toBe(true);
    expect(kindTakesTeamKnowledge(undefined)).toBe(true);
  });

  it("clears a scope with empty text and refuses oversized text", () => {
    writeKindInstructions("code", "rules");
    expect(writeKindInstructions("code", "   ")).toBeNull();
    expect(readKindInstructions().code).toBeUndefined();
    expect(() => writeKindInstructions("code", "x".repeat(KIND_INSTRUCTIONS_MAX_BYTES + 1))).toThrow("capped");
  });

  it("stores a bot's kind from creation and keeps members from changing it", () => {
    const store = new Store(() => ({ instanceId: "claude", model: "claude-sonnet-5" }));
    expect(store.createBot({ name: "Coder", kind: "code" }).kind).toBe("code");
    expect(store.createBot({ name: "Planner" }).kind).toBeUndefined();
    expect(clientBotPatchViolation({ kind: "code" })).toBe("kind");
  });
});
