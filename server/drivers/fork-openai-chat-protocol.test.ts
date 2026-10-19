// Fork: a completion whose opaque reasoning blocks outgrow the bound keeps
// going without them (DeepSeek via OpenRouter, 2026-10-19: the Designer's
// turns failed with "provider reasoning details exceeded the size limit").
import { describe, expect, it } from "vitest";

import { ChatProtocolError, ChatReasoningDetails } from "./openai-chat-protocol.ts";

describe("ChatReasoningDetails", () => {
  it("drops every block once the total passes the bound, and ignores later ones", () => {
    const details = new ChatReasoningDetails();
    details.add([{ type: "reasoning.text", text: "short" }]);
    expect(details.blocks).toHaveLength(1);
    details.add([{ type: "reasoning.text", text: "x".repeat(256_001) }]);
    expect(details.blocks).toEqual([]);
    details.add([{ type: "reasoning.text", text: "after" }]);
    expect(details.blocks).toEqual([]);
  });

  it("still refuses blocks that are not objects", () => {
    expect(() => new ChatReasoningDetails().add(["text"])).toThrow(ChatProtocolError);
  });
});
