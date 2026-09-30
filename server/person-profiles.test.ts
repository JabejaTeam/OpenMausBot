import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { personKeyForEmail } from "./person-key.ts";
import {
  notePerson, PEOPLE_DIR, PERSON_PROFILE_MAX_LINES, personTurnPreamble, readPersonProfile, savePersonProfile, updatePersonProfile,
} from "./person-profiles.ts";

const ADA = personKeyForEmail("ada@example.test");
const BOB = personKeyForEmail("bob@example.test");

describe("person profiles", () => {
  beforeEach(() => rmSync(PEOPLE_DIR, { recursive: true, force: true }));

  it("keeps each person's profile apart and names them in the turn", () => {
    notePerson(ADA, "Ada@Example.test");
    notePerson(BOB, "bob@example.test");
    expect(savePersonProfile(ADA, { name: "Ada", text: "- Prefers short answers" }).ok).toBe(true);
    const ada = personTurnPreamble(readPersonProfile(ADA), true);
    expect(ada).toContain("working for Ada (ada@example.test)");
    expect(ada).toContain("Prefers short answers");
    expect(ada).toContain("person_profile_update");
    const bob = personTurnPreamble(readPersonProfile(BOB), false);
    expect(bob).toContain("working for bob@example.test");
    expect(bob).toContain("no profile yet");
    expect(bob).not.toContain("short answers");
    expect(bob).not.toContain("person_profile_update");
    expect(personTurnPreamble(undefined, true)).toBe("");
  });

  it("keeps the bots a person hides with their profile, through a bot's edits", () => {
    notePerson(ADA, "ada@example.test");
    expect(savePersonProfile(ADA, { hiddenBots: ["b1", "b2", "b1"] }).ok).toBe(true);
    expect(readPersonProfile(ADA)?.hiddenBots).toEqual(["b1", "b2"]);
    expect(updatePersonProfile(ADA, { action: "append", text: "Likes tables" }).ok).toBe(true);
    expect(readPersonProfile(ADA)?.hiddenBots).toEqual(["b1", "b2"]);
    expect(personTurnPreamble(readPersonProfile(ADA), true)).not.toContain("b1");
    expect(readPersonProfile(BOB)?.hiddenBots).toBeUndefined();
    expect(savePersonProfile(ADA, { hiddenBots: "b1" })).toMatchObject({ ok: false, code: "invalid" });
    expect(savePersonProfile(ADA, { hiddenBots: ["../x"] })).toMatchObject({ ok: false, code: "invalid" });
    expect(savePersonProfile(ADA, { hiddenBots: [] }).ok).toBe(true);
    expect(readPersonProfile(ADA)?.hiddenBots).toBeUndefined();
  });

  it("lets a bot append, replace and remove one fact at a time", () => {
    notePerson(ADA, "ada@example.test");
    expect(updatePersonProfile(ADA, { action: "append", text: "Writes in Dutch" }).ok).toBe(true);
    expect(updatePersonProfile(ADA, { action: "append", text: "Likes tables" }).ok).toBe(true);
    expect(readPersonProfile(ADA)?.text).toBe("- Writes in Dutch\n- Likes tables");
    expect(updatePersonProfile(ADA, { action: "replace", oldText: "Likes tables", text: "Dislikes tables" }).ok).toBe(true);
    expect(updatePersonProfile(ADA, { action: "remove", oldText: "- Writes in Dutch" }).ok).toBe(true);
    expect(readPersonProfile(ADA)?.text).toBe("- Dislikes tables");
    expect(updatePersonProfile(ADA, { action: "replace", oldText: "missing", text: "x" })).toMatchObject({ ok: false, code: "conflict" });
    expect(updatePersonProfile(ADA, { action: "append", text: "two\nlines" })).toMatchObject({ ok: false, code: "invalid" });
    expect(updatePersonProfile(ADA, { action: "rewrite", text: "x" })).toMatchObject({ ok: false, code: "invalid" });
  });

  it("refuses a profile over the line budget and a name over one line", () => {
    const full = Array.from({ length: PERSON_PROFILE_MAX_LINES }, (_, i) => `- fact ${i}`).join("\n");
    expect(savePersonProfile(ADA, { text: full }).ok).toBe(true);
    expect(updatePersonProfile(ADA, { action: "append", text: "one more" })).toMatchObject({ ok: false, code: "over-budget" });
    expect(savePersonProfile(ADA, { name: "Ada\nLovelace" })).toMatchObject({ ok: false, code: "invalid" });
  });
});
