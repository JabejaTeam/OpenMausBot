import { describe, expect, it } from "vitest";
import { botLabel, botLabelLine, botLabelPhrase, botSearchText, threadTitle } from "./bot-label";

describe("botLabel", () => {
  it("names a team's PM Manager, team underneath", () => {
    expect(botLabel({ name: "Ripal PM", kind: "pm", section: "Ripal" })).toEqual({ name: "Manager", team: "Ripal" });
  });

  it("reads PM in the name as Manager when the kind is missing", () => {
    expect(botLabel({ name: "Waregem Koerse PM", section: "Waregem Koerse" })).toEqual({ name: "Manager", team: "Waregem Koerse" });
  });

  it("drops the team from the front or the back of the name", () => {
    expect(botLabel({ name: "Ripal Code", kind: "code", section: "Ripal" })).toEqual({ name: "Code", team: "Ripal" });
    expect(botLabel({ name: "Code Jabeja", kind: "code", section: "Jabeja" })).toEqual({ name: "Code", team: "Jabeja" });
    expect(botLabel({ name: "Heilig Hart Tester", kind: "test", section: "Heilig Hart" })).toEqual({ name: "Tester", team: "Heilig Hart" });
    expect(botLabel({ name: "BOA Code Agent", kind: "code", section: "BOA" })).toEqual({ name: "Code Agent", team: "BOA" });
  });

  it("keeps a name that does not carry its team", () => {
    expect(botLabel({ name: "Monitor", kind: "code", section: "Monitoring" })).toEqual({ name: "Monitor", team: "Monitoring" });
    expect(botLabel({ name: "Boekhouder", section: "Jabeja" })).toEqual({ name: "Boekhouder", team: "Jabeja" });
  });

  it("only strips whole words", () => {
    expect(botLabel({ name: "Ripalino", section: "Ripal" })).toEqual({ name: "Ripalino", team: "Ripal" });
  });

  it("keeps the full name when the name is just the team", () => {
    expect(botLabel({ name: "SEO", section: "SEO" })).toEqual({ name: "SEO", team: "SEO" });
  });

  it("leaves bots without a team alone", () => {
    expect(botLabel({ name: "Jarvis" })).toEqual({ name: "Jarvis" });
    expect(botLabel({ name: "Jarvis", section: "  " })).toEqual({ name: "Jarvis" });
  });

  it("folds into one line", () => {
    expect(botLabelLine({ name: "Ripal PM", kind: "pm", section: "Ripal" })).toBe("Manager · Ripal");
    expect(botLabelLine({ name: "Jarvis" })).toBe("Jarvis");
  });
});

describe("threadTitle", () => {
  const bots = [{ id: "pm", name: "Ripal PM", kind: "pm", section: "Ripal" }];
  const openedBy = { botId: "pm", name: "Ripal PM" };

  it("keeps the topic of a bot-opened thread", () => {
    expect(threadTitle({ title: "@Ripal PM · Sleeptest", openedBy }, bots)).toEqual({ title: "Sleeptest", fromOpener: true });
  });

  it("names the opener by role when there is no topic", () => {
    expect(threadTitle({ title: "@Ripal PM", openedBy }, bots)).toEqual({ title: "Manager", fromOpener: true });
    expect(threadTitle({ title: "@Jarvis", openedBy: { botId: "gone", name: "Jarvis" } }, bots)).toEqual({ title: "Jarvis", fromOpener: true });
  });

  it("leaves other titles alone", () => {
    expect(threadTitle({ title: "Depotkaart" }, bots)).toEqual({ title: "Depotkaart", fromOpener: false });
    expect(threadTitle({ title: "@Ripal PMs planning", openedBy }, bots)).toEqual({ title: "@Ripal PMs planning", fromOpener: false });
    expect(threadTitle({ title: "@Ripal PM · x", openedBy: { botId: "c", name: "Ripal Code" } }, bots)).toEqual({ title: "@Ripal PM · x", fromOpener: false });
  });
});

describe("botLabelPhrase", () => {
  it("names a teamed bot inside a sentence without the dot", () => {
    expect(botLabelPhrase({ name: "Ripal PM", kind: "pm", section: "Ripal" })).toBe("Ripal Manager");
    expect(botLabelPhrase({ name: "Jarvis" })).toBe("Jarvis");
  });
});

describe("botSearchText", () => {
  it("matches both the shown name and the real name", () => {
    const text = botSearchText({ name: "Jabeja PM", kind: "pm", section: "Jabeja" });
    expect(text).toContain("Manager · Jabeja");
    expect(text).toContain("Jabeja PM");
  });
});
