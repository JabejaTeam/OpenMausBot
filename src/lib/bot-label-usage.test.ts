import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// lib/bot-label is the one place that decides how a bot is named on screen
// (the role, a team's PM is "Manager"). A component that prints `bot.name`
// itself shows "Jabeja PM" beside a header saying "Manager". So every bot
// name a person reads goes through botLabel/botLabelLine/BotName; a real
// name kept on purpose (rename field, mention text, server payload) carries
// a `bot-name: identity` comment on its line or the line above.

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..");

const BOT = "(?:[a-zA-Z]*[bB]ot|member|teammate|lead|opener|candidate|assignee|recipient|peer)";
// JSX text/attribute `{bot.name}`, i18n/menu params `name: bot.name` / `label:` / `title:`, templates `${bot.name}`
const display = new RegExp(`(?:(?<![=])\\{|\\bname:|\\blabel:|\\btitle:|\\$\\{)\\s*${BOT}\\??\\.name\\b(?!\\s*[=!]==?)`);
const identityProp = /\b(?:key|value|defaultValue)=\{/;
const marker = "bot-name: identity";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("bot names on screen", () => {
  it("go through lib/bot-label", () => {
    const raw: string[] = [];
    for (const file of files(join(srcRoot, "components"))) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!display.test(line) || identityProp.test(line)) return;
        if (line.includes(marker) || lines[index - 1]?.includes(marker)) return;
        raw.push(`${relative(srcRoot, file)}:${index + 1}: ${line.trim()}`);
      });
    }
    expect(raw).toEqual([]);
  });
});
