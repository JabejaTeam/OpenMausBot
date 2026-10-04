import { describe, expect, it } from "vitest";
import { searchBots, type SearchBot } from "./office-search";

const bot = (name: string, patch: Partial<SearchBot> = {}): SearchBot => ({ id: name, threadId: `${name}-t`, name, ...patch });
const team: Record<string, string> = { "Code Ripal": "Ripal", "PM Ripal": "Ripal", "Code Jabeja": "Jabeja", SEO: "Jabeja", Boekhouder: "Jabeja" };
const teamOf = (b: SearchBot) => team[b.name] ?? "";
const names = (bots: SearchBot[]) => bots.map((b) => b.name);

describe("searchBots", () => {
  const bots = [bot("Code Jabeja"), bot("SEO", { title: "Search marketing" }), bot("Code Ripal"), bot("PM Ripal"), bot("Boekhouder")];

  it("finds nothing for an empty query", () => {
    expect(searchBots(bots, "  ", teamOf)).toEqual([]);
  });

  it("ranks a name start before a word start before a team match", () => {
    expect(names(searchBots(bots, "ri", teamOf))).toEqual(["Code Ripal", "PM Ripal"]);
    expect(names(searchBots(bots, "code", teamOf))).toEqual(["Code Jabeja", "Code Ripal"]);
    expect(names(searchBots(bots, "jabeja", teamOf))).toEqual(["Code Jabeja", "SEO", "Boekhouder"]);
  });

  it("matches the job title and ignores case and accents", () => {
    expect(names(searchBots(bots, "MARKETING", teamOf))).toEqual(["SEO"]);
    expect(names(searchBots([bot("Café bot")], "cafe"))).toEqual(["Café bot"]);
  });

  it("puts whoever waits on you first among equal matches", () => {
    const withStatus = [bot("Code Jabeja"), bot("Code Ripal", { activity: "waiting-on-you" })];
    expect(names(searchBots(withStatus, "code", teamOf))).toEqual(["Code Ripal", "Code Jabeja"]);
  });
});
