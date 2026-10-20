import { describe, expect, it } from "vitest";
import { memberInTeam, proposalTeam } from "./fork-team-memory-members.ts";

const hermien = { kind: "member", email: "hermien@ripal.be" } as const;
const bots = [
  { id: "orders", section: "Ripal", visibility: { people: ["miguel@ripal.be", "hermien@ripal.be"] } },
  { id: "prijs", section: "Ripal", visibility: { people: ["miguel@ripal.be"] } },
  { id: "marie-jeanne", visibility: { people: ["hermien@ripal.be"], private: true as const } },
  { id: "rik", visibility: { people: ["pepijn@ripal.be"], private: true as const } },
  { id: "geheim", section: "Prive", visibility: { people: ["hermien@ripal.be"], private: true as const } },
];

describe("memberInTeam", () => {
  it("lets a member review memory of a team whose shared agent they see", () => {
    expect(memberInTeam(hermien, "Ripal", bots)).toBe(true);
    expect(memberInTeam(hermien, " Ripal ", bots)).toBe(true);
  });

  it("keeps General, other teams and private-only teams to admins", () => {
    expect(memberInTeam(hermien, "", bots)).toBe(false);
    expect(memberInTeam(hermien, "Andere", bots)).toBe(false);
    expect(memberInTeam(hermien, "Prive", bots)).toBe(false);
    expect(memberInTeam({ kind: "member", email: "logistics@ripal.be" }, "Ripal", bots)).toBe(false);
  });
});

describe("proposalTeam", () => {
  it("keeps a bot's own team", () => {
    expect(proposalTeam(bots[0], bots)).toBe("Ripal");
  });

  it("sends a personal agent's proposal to its person's only team", () => {
    expect(proposalTeam(bots[2], bots)).toBe("Ripal");
  });

  it("stays General without a person, a team, or with several teams", () => {
    expect(proposalTeam(bots[3], bots)).toBe("");
    expect(proposalTeam({ id: "x" }, bots)).toBe("");
    const twoTeams = [...bots, { id: "heat", section: "Heat", visibility: { people: ["hermien@ripal.be"] } }];
    expect(proposalTeam(bots[2], twoTeams)).toBe("");
  });
});
