import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { otherSenderName, setPeopleForTest } from "./people";
import { replyAuthor } from "./replies";

const msg = (patch: Partial<Message>): Message => ({ id: "m", role: "user", kind: "text", text: "hi", at: 0, ...patch }) as Message;

describe("who sent a person's message", () => {
  it("names everyone but the viewer, by profile name, else the name the row carries", () => {
    setPeopleForTest({ me: "p_me", names: { p_yren: "Yren Delhaye" } });
    expect(otherSenderName(msg({ sender: { name: "yren@jabeja.be", id: "p_yren" } }))).toBe("Yren Delhaye");
    expect(otherSenderName(msg({ sender: { name: "mahak@jabeja.be", id: "p_mahak" } }))).toBe("mahak@jabeja.be");
    expect(otherSenderName(msg({ sender: { name: "wiebren@jabeja.be", id: "p_me" } }))).toBeUndefined();
    // the owner's own rows and older ones carry no sender
    expect(otherSenderName(msg({}))).toBeUndefined();
    expect(otherSenderName(msg({ role: "bot", sender: { name: "x", id: "p_yren" } }))).toBeUndefined();
    expect(replyAuthor(msg({ sender: { name: "yren@jabeja.be", id: "p_yren" } }))).toBe("Yren Delhaye");
  });
});
