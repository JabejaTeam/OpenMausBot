import { describe, expect, it } from "vitest";
import { botPatchViolation, canEditBot, ownsBot, personalOwner } from "./bot-edit-access.ts";

const yren = { people: ["yren@jabeja.be"], private: true as const };

describe("personalOwner", () => {
  it("is the one address of a private audience", () => {
    expect(personalOwner(yren)).toBe("yren@jabeja.be");
    expect(personalOwner({ people: ["a@x.be", "b@x.be"], private: true })).toBeUndefined();
    expect(personalOwner({ people: ["yren@jabeja.be"] })).toBeUndefined();
    expect(personalOwner({ people: ["@jabeja.be"], private: true })).toBeUndefined();
    expect(personalOwner("everyone")).toBeUndefined();
  });
});

describe("canEditBot", () => {
  it("lets admins change every agent and a person only their own personal agent", () => {
    expect(canEditBot({ admin: true }, "everyone")).toBe(true);
    expect(canEditBot({ admin: false, email: "Yren@Jabeja.be" }, yren)).toBe(true);
    expect(canEditBot({ admin: false, email: "mahak@jabeja.be" }, yren)).toBe(false);
    expect(canEditBot({ admin: false, email: "yren@jabeja.be" }, "everyone")).toBe(false);
    expect(ownsBot(undefined, yren)).toBe(false);
  });
});

describe("botPatchViolation", () => {
  it("leaves everyone their reading state, the owner the look, the rest to admins", () => {
    expect(botPatchViolation({ unread: false, pinned: true }, false)).toBeNull();
    expect(botPatchViolation({ color: "blue" }, false)).toBe("color");
    expect(botPatchViolation({ color: "blue", mascotBody: "blob" }, true)).toBeNull();
    expect(botPatchViolation({ autoApprove: true }, true)).toBe("autoApprove");
  });
});
