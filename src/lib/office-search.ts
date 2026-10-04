// Office view (fork): find an agent by typing. Matches name, team and job
// title; a name match beats a team or title match, an earlier match in the
// name beats a later one, and among equals whoever needs you comes first.
import { botStatus, type OfficeStatus, type StatusBot } from "./office-status";

export interface SearchBot extends StatusBot {
  name: string;
  title?: string | null;
}

const STATUS_RANK: Record<OfficeStatus, number> = { waiting: 0, working: 1, unread: 2, idle: 3 };

const fold = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** 0 best: name starts with it, 1 a word in the name does, 2 the name has
 * it, 3 team or title has it; null no match. */
function matchRank(bot: SearchBot, team: string, query: string): number | null {
  const name = fold(bot.name);
  if (name.startsWith(query)) return 0;
  if (name.split(/[\s\-_.]+/).some((word) => word.startsWith(query))) return 1;
  if (name.includes(query)) return 2;
  if (fold(team).includes(query) || fold(bot.title ?? "").includes(query)) return 3;
  return null;
}

export function searchBots<B extends SearchBot>(bots: B[], query: string, teamOf: (bot: B) => string = () => "", limit = 8): B[] {
  const q = fold(query.trim());
  if (!q) return [];
  return bots
    .map((bot, index) => ({ bot, index, rank: matchRank(bot, teamOf(bot), q) }))
    .filter((hit): hit is { bot: B; index: number; rank: number } => hit.rank !== null)
    .sort((a, b) => a.rank - b.rank || STATUS_RANK[botStatus(a.bot)] - STATUS_RANK[botStatus(b.bot)] || a.index - b.index)
    .slice(0, limit)
    .map((hit) => hit.bot);
}
