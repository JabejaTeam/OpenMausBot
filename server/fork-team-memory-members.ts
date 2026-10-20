// Fork: team memory belongs to a team, so the team reviews it.
//   - a member may answer a "Remember this for the team?" card for a named
//     team (section) they are part of: they see at least one of its shared
//     (non-private) agents. The unsectioned General team stays admin-only;
//   - a personal agent (private to one person, no team of its own) proposes
//     into its person's team, when that person is in exactly one: Hermien's
//     Marie-Jeanne → Ripal, so Orders and Boekhoud learn it too. Otherwise
//     General, as before.
// Pure: no store, no server.
import { personalOwner } from "../shared/bot-edit-access.ts";
import { isPrivateValue, viewerSees, type Viewer } from "./bot-visibility.ts";
import { sectionContextKey } from "./section-context.ts";

type TeamBot = { id: string; section?: string | null; visibility?: unknown };

/** Whether a member viewer is part of this named team. */
export function memberInTeam(viewer: Viewer, section: string, bots: readonly TeamBot[]): boolean {
  const team = sectionContextKey(section);
  if (!team) return false;
  return bots.some((bot) => sectionContextKey(bot.section) === team
    && !isPrivateValue(bot.visibility) && viewerSees(viewer, bot.visibility));
}

/** The team a bot's team-memory proposal goes to (a section key). */
export function proposalTeam(bot: TeamBot, bots: readonly TeamBot[]): string {
  const own = sectionContextKey(bot.section);
  if (own) return own;
  const owner = personalOwner(bot.visibility);
  if (!owner) return "";
  const viewer: Viewer = { kind: "member", email: owner };
  const teams = new Set(bots
    .filter((other) => other.id !== bot.id && sectionContextKey(other.section))
    .filter((other) => memberInTeam(viewer, sectionContextKey(other.section), [other]))
    .map((other) => sectionContextKey(other.section)));
  return teams.size === 1 ? [...teams][0] : "";
}
