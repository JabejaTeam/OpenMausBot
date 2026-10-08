// Office (fork): who sits where and how each bean looks — the one source for
// the 3D office and for every bot avatar in the app (BeanBotAvatar). A bean
// wears its team's wall colour (lib/office-team-looks) and moves by status.
import type { AppState, Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { MAUS_COLORS } from "@/lib/mascot";
import { hiddenBotsForMe } from "@/lib/people";
import { BOTS_SECTION_ID, orderedSidebarSections, shownForMe, userSectionId } from "@/lib/sidebar-layout";
import { loadSectionOrder } from "@/lib/sidebar-preferences";
import { simpleSidebarLayout } from "@/lib/simple-ui-groups";
import { officeLayout, type OfficeLayout, type OfficeTeam } from "@/lib/office-layout";
import { botStatus, hasUnread } from "@/lib/office-status";
import { agentColorsFor, type TeamLook } from "@/lib/office-team-looks";
import { sidebarBotActivityTasks } from "../SidebarBotActivity";
import type { OfficeBotLook } from "./office-scene";

function isWorking(bot: Bot, pendingQueued: AppState["pendingQueued"]): boolean {
  return Boolean(bot.busy) || sidebarBotActivityTasks(bot, pendingQueued).some((task) => task.busy || task.activity === "working");
}

/** Same teams, order and visibility as the Simple UI list. */
export function officeTeams(state: Pick<AppState, "bots" | "sections">) {
  const hiddenForMe = hiddenBotsForMe();
  const bots = state.bots.filter((bot) => shownForMe(bot, hiddenForMe, ""));
  const grouped = simpleSidebarLayout(bots, [], state.sections ?? []);
  const idOf = (section?: string) => (section ? userSectionId(section) : BOTS_SECTION_ID);
  const order = orderedSidebarSections(grouped.groups.map((group) => idOf(group.section)), loadSectionOrder());
  const teams: OfficeTeam[] = [...grouped.groups]
    .sort((a, b) => order.indexOf(idOf(a.section)) - order.indexOf(idOf(b.section)))
    .map((group) => ({ id: group.id, label: group.section ?? t("simpleUi.unassigned"), bots: group.bots }));
  const hero: OfficeTeam | null = grouped.hero ? { id: "hero", label: grouped.hero.name, bots: [grouped.hero] } : null;
  return { bots, teams, hero };
}

export function botLooks(
  bots: Bot[],
  pendingQueued: AppState["pendingQueued"],
  layout: Pick<OfficeLayout, "rooms" | "desks">,
  teamLooks: Record<string, TeamLook>,
): Map<string, OfficeBotLook> {
  const agentColors = agentColorsFor(layout, teamLooks);
  const looks = new Map<string, OfficeBotLook>();
  for (const bot of bots) {
    looks.set(bot.id, {
      name: bot.name,
      color: agentColors.get(bot.id) ?? MAUS_COLORS[bot.color] ?? MAUS_COLORS.blue,
      working: isWorking(bot, pendingQueued),
      waiting: botStatus(bot) === "waiting",
      unread: hasUnread(bot),
      chief: Boolean(bot.chiefOfStaff),
    });
  }
  return looks;
}

// once per store state and team looks, however many avatars ask
const cache = new WeakMap<AppState, { teamLooks: Record<string, TeamLook>; looks: Map<string, OfficeBotLook> }>();

/** Every bot's bean look, exactly as the office shows it. */
export function beanLooksFor(state: AppState, teamLooks: Record<string, TeamLook>): Map<string, OfficeBotLook> {
  const hit = cache.get(state);
  if (hit && hit.teamLooks === teamLooks) return hit.looks;
  const { bots, teams, hero } = officeTeams(state);
  const looks = botLooks(bots, state.pendingQueued, officeLayout(teams, hero), teamLooks);
  cache.set(state, { teamLooks, looks });
  return looks;
}
