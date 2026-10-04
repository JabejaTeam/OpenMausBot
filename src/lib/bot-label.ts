// Fork: how a bot is named on screen. Bots carry their team in their name
// ("Ripal Code", "Code Jabeja") so they can address each other; people see
// the role, with the team small underneath. A team's PM is its "Manager".
// The real name stays the bot's identity (mentions, delegation, rename).
import { t } from "@/lib/i18n";

export interface BotLabel {
  /** the role: "Manager", "Code", "Tester" — or the full name when there is no team */
  name: string;
  /** the team (client) it works for, shown small under the name */
  team?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function botLabel(bot: { name: string; kind?: string; section?: string }): BotLabel {
  const team = bot.section?.trim() || undefined;
  if (bot.kind === "pm") return { name: t("bot.role.manager"), team };
  if (!team) return { name: bot.name };
  const words = escapeRegExp(team).replace(/\s+/g, "\\s+");
  const role = bot.name.replace(new RegExp(`^\\s*${words}\\b|\\b${words}\\s*$`, "i"), "").trim();
  if (!role) return { name: bot.name, team };
  return { name: /^pm$/i.test(role) ? t("bot.role.manager") : role, team };
}

/** One line where there is no room for two: "Manager · Ripal". */
export function botLabelLine(bot: { name: string; kind?: string; section?: string }): string {
  const { name, team } = botLabel(bot);
  return team ? `${name} · ${team}` : name;
}

/** A thread's title as people read it (fork). A bot-opened thread is titled
 * "@Opener" or "@Opener · topic" by the server: people read the topic, or
 * the opener's role when there is none. `fromOpener` marks a title read
 * this way, so the row drops its "opened by" line (one fact, said once). */
export function threadTitle(
  task: { title: string; openedBy?: { botId: string; name: string } },
  bots: ReadonlyArray<{ id: string; name: string; kind?: string; section?: string }> = [],
): { title: string; fromOpener: boolean } {
  const opener = task.openedBy;
  const prefix = opener ? `@${opener.name.trim()}` : "";
  if (!prefix || !task.title.startsWith(prefix)) return { title: task.title, fromOpener: false };
  const rest = task.title.slice(prefix.length);
  if (rest && !/^\s*·/.test(rest)) return { title: task.title, fromOpener: false };
  const topic = rest.replace(/^\s*·\s*/, "").trim();
  if (topic) return { title: topic, fromOpener: true };
  const bot = bots.find((candidate) => candidate.id === opener!.botId) ?? { name: opener!.name };
  return { title: botLabel(bot).name, fromOpener: true };
}
