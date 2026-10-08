// Simple UI (fork): the one-list sidebar — chief on top, bots and rooms
// filed by lib/simple-ui-groups, profile and connected apps at the bottom.
// Threads: hovering a bot shows the thread list toggle and a new-thread button;
// threads show only in the thread column, never under the bot. Each team shows as one
// row, its lead (the PM); a bot without a team is its own row. No headings:
// like Messages, the row you last wrote to is on top (lib/simple-ui-groups).
import { useState } from "react";
import { ChevronDown, ChevronLeft, PanelLeft } from "lucide-react";
import { useStore, visibleMessages, type Bot, type Group } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { botLabel, botLabelLine } from "@/lib/bot-label";
import { stateForBot } from "@/lib/mascot";
import { hiddenBotsForMe, usePeople } from "@/lib/people";
import { shownForMe } from "@/lib/sidebar-layout";
import { lastSentAt, simpleSidebarLayout, simpleSidebarRows, teamToOpen, type SimpleGroup } from "@/lib/simple-ui-groups";
import { BotAvatar, InitialsAvatar } from "./Avatar";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { groupPreview, preview } from "./Sidebar";
import { BotThreads, setThreadColumn, useThreadColumn } from "./BotThreads";
import { unreadForMe } from "@/lib/thread-channel";
import { SidebarPopoverMenu } from "./SidebarPopoverMenu";
import { sidebarBotActivityTasks } from "./SidebarBotActivity";
import { WorkingDots } from "./WorkingIndicator";
import { profileInitials } from "./SidebarProfileMenu";


function Row({
  selected,
  unread,
  avatar,
  name,
  sub,
  subNode,
  onClick,
}: {
  selected: boolean;
  unread?: boolean;
  avatar: React.ReactNode;
  name: string;
  sub: string;
  subNode?: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors",
        selected ? "bg-raised" : "hover:bg-raised/50",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center">{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{name}</span>
        {subNode ?? <span className="block truncate text-[13.5px] leading-5 text-ink-secondary">{sub || " "}</span>}
      </span>
      {unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label={t("task.unread")} />}
    </button>
  );
}

/** A bot row (Grok look). Its threads live only in the thread column
 * (SimpleThreadColumn); the row just shows the unread dot. */
function BotRow({ bot, title, active = false, teamUnread = false }: {
  bot: Bot;
  /** the name shown instead of the bot's (a team's row shows the team) */
  title?: string;
  /** shown selected although the bot itself is not (a teammate is open) */
  active?: boolean;
  /** a teammate behind this row has something unread */
  teamUnread?: boolean;
}) {
  const { state, dispatch } = useStore();
  const selected = state.activeView === "chat" && (state.selectedId === bot.id || active);
  const activity = sidebarBotActivityTasks(bot, state.pendingQueued);
  const working = Boolean(bot.busy) || activity.some((task) => task.busy || task.activity === "working");
  const unread = unreadForMe(bot);
  return (
    <Row
      selected={selected}
      unread={unread || teamUnread}
      avatar={
        <span className="relative flex">
          <BotAvatar bot={bot} state={working ? stateForBot(bot) : "happy"} size={40} animated={working} />
          {working && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-success" />}
        </span>
      }
      name={title ?? botLabel(bot).name}
      sub={working ? "" : preview(bot, visibleMessages(bot), state.instances)}
      subNode={working ? <span className="flex h-5 items-center" role="status"><WorkingDots size={3.5} /></span> : undefined}
      onClick={() => dispatch({ type: "select", id: bot.id })}
    />
  );
}

/** The unsectioned chief, big on top; its threads live in the thread column. */
function HeroBot({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  const activity = sidebarBotActivityTasks(bot, state.pendingQueued);
  const working = Boolean(bot.busy) || activity.some((task) => task.busy || task.activity === "working");
  const unread = unreadForMe(bot);
  return (
    <div className="mb-2">
      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => dispatch({ type: "select", id: bot.id })}
          aria-current={selected ? "page" : undefined}
          className="mt-1 flex flex-col items-center gap-1.5 rounded-2xl px-4 py-2 hover:bg-raised/40"
        >
          <span className="relative">
            <BotAvatar bot={bot} state={working ? stateForBot(bot) : "happy"} size={76} animated={working} />
            {unread && <span className="absolute right-0 top-1 size-2.5 rounded-full bg-accent" />}
            {working && <span className="absolute bottom-1 right-1 size-3 rounded-full border-2 border-panel bg-success" />}
          </span>
          <span className={cn("text-[13px] font-medium", selected ? "text-ink" : "text-ink-secondary")}>{botLabel(bot).name}</span>
        </button>
      </div>
    </div>
  );
}

/** The Model Context Protocol mark: the connected apps are MCP servers.
 * Drawn inline (no remote logo fetch), in the text colour. */
function McpMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 180 180" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" aria-hidden="true">
      <path d="M18 84.85 85.88 16.97c9.37-9.37 24.57-9.37 33.94 0 9.37 9.37 9.37 24.57 0 33.94L68.56 102.18" />
      <path d="M69.27 101.47 119.82 50.91c9.37-9.37 24.57-9.37 33.94 0l.35.36c9.37 9.37 9.37 24.57 0 33.94L92.72 146.6a8 8 0 0 0 0 11.31l12.61 12.61" />
      <path d="M102.85 33.94 52.65 84.15c-9.37 9.37-9.37 24.57 0 33.94 9.37 9.37 24.57 9.37 33.94 0l50.2-50.2" />
    </svg>
  );
}

function RoomAvatar({ members }: { members: Bot[] }) {
  const shown = members.slice(0, 3);
  return (
    <span className="relative size-10">
      {shown.map((bot, index) => (
        <span
          key={bot.id}
          className="absolute rounded-full bg-panel"
          style={{ left: index * 9, top: index === 1 ? 14 : index * 4, zIndex: 3 - index }}
        >
          <BotAvatar bot={bot} state="happy" size={24} motion="none" motionKey={0} animated={false} />
        </span>
      ))}
    </span>
  );
}

export function SimpleSidebar({ open }: { open: boolean; onClose: () => void }) {
  const { state, dispatch } = useStore();
  usePeople();
  const { capabilities } = useDesktopCapabilities();
  const hiddenForMe = hiddenBotsForMe();
  const bots = state.bots.filter((bot) => shownForMe(bot, hiddenForMe, ""));
  const layout = simpleSidebarLayout(bots, state.groups, state.sections ?? []);
  const hero = layout.hero;
  // Like Messages: the team (or bot) you last wrote to on top, no headings
  const rows = simpleSidebarRows(layout.groups, (item) => lastSentAt(visibleMessages(item)));
  // A teammate (picked from the thread column's switcher) lights up its team's row
  const selectedTeam = teamToOpen(layout.groups, state.selectedId);
  const teammateUnread = (group: SimpleGroup<Bot, Group>, lead: Bot) =>
    group.bots.some((bot) => bot !== lead && unreadForMe(bot)) || group.rooms.some((room) => room.unread);
  const chatView = state.activeView === "chat";
  const select = (id: string) => dispatch({ type: "select", id });
  const threadColumn = useThreadColumn();
  const macInset = capabilities.windowChrome === "mac-inset";
  const draggable = macInset || capabilities.windowChrome === "win-caption";
  // SAFETY: Electron-only CSS property, same as Sidebar's window drag row.
  const dragStyle = draggable ? ({ WebkitAppRegion: "drag" } as React.CSSProperties) : undefined;
  const noDragStyle = draggable ? ({ WebkitAppRegion: "no-drag" } as React.CSSProperties) : undefined;
  const circle =
    "flex size-10 items-center justify-center rounded-full border border-hairline/40 bg-app/40 text-ink hover:bg-raised";

  return (
    <aside
      aria-label={t("sidebar.aria")}
      data-native-view-overlay
      data-sidebar
      data-simple-ui
      className={cn(
        "flex h-full w-64 shrink-0 flex-col bg-panel",
        // same mobile drawer rules as Sidebar (see its className comment)
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40",
        "max-md:transition-transform max-md:duration-200",
        open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}
    >
      <div className="flex items-center justify-between px-4 pb-1 pt-3" style={dragStyle}>
        <div className={macInset ? "w-16" : undefined} />
        {/* the thread column beside this list (SimpleThreadColumn) */}
        <button
          type="button"
          style={noDragStyle}
          onClick={() => setThreadColumn(!threadColumn)}
          aria-pressed={threadColumn}
          aria-label={t(threadColumn ? "office.hideThreads" : "office.showThreads")}
          title={t(threadColumn ? "office.hideThreads" : "office.showThreads")}
          className={cn(circle, "max-md:hidden", !threadColumn && "text-ink-secondary")}
        >
          <PanelLeft size={18} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {hero && <HeroBot bot={hero} />}
        {rows.map((row) => row.kind === "team" ? (
          // the team's name: a message here goes to its lead (the PM)
          <BotRow key={row.key} bot={row.lead} title={row.group.section} active={selectedTeam === row.group.id} teamUnread={teammateUnread(row.group, row.lead)} />
        ) : row.kind === "bot" ? (
          <BotRow key={row.key} bot={row.bot} />
        ) : (
          <Row
            key={row.key}
            selected={chatView && state.selectedId === row.room.id}
            unread={row.room.unread}
            avatar={<RoomAvatar members={state.bots.filter((bot) => row.room.memberIds.includes(bot.id))} />}
            name={row.room.name}
            sub={groupPreview(row.room, state.bots, state.instances)}
            onClick={() => select(row.room.id)}
          />
        ))}
      </div>

      <div className="flex items-center gap-2.5 px-4 pb-4 pt-2">
        <button
          type="button"
          onClick={() => dispatch({ type: "toggleAppSettings" })}
          aria-label={t("sidebar.appSettings")}
          title={t("sidebar.appSettings")}
          className="rounded-full hover:opacity-90"
        >
          <InitialsAvatar initials={profileInitials(state.config?.profile)} size={40} />
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: "togglePlugins", open: true })}
          aria-label={t("simpleUi.connectApps")}
          title={t("simpleUi.connectApps")}
          className={circle}
        >
          <McpMark />
        </button>
      </div>
    </aside>
  );
}

/** Simple UI (fork): the open bot's threads in a column beside the list —
 * every thread, old ones too; folds away from the list's header button. */
export function SimpleThreadColumn() {
  const { state, dispatch } = useStore();
  const shown = useThreadColumn();
  // clip only while sliding or closed, so the team menu can hang past the column
  // (reduced motion keeps a 1ms transition so transitionend still settles it)
  const [settled, setSettled] = useState(shown);
  const bot = state.activeView === "chat" ? state.bots.find((candidate) => candidate.id === state.selectedId) : undefined;
  if (!bot) return null;
  // the bot's team, in the list's order: switch between them from the title
  const hiddenForMe = hiddenBotsForMe();
  const { groups } = simpleSidebarLayout(state.bots.filter((candidate) => shownForMe(candidate, hiddenForMe, "")), [], state.sections ?? []);
  const team = groups.find((group) => group.section && group.bots.some((candidate) => candidate.id === bot.id))?.bots ?? [bot];
  const title = <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">{botLabel(bot).name}</span>;
  return (
    // stays mounted so it can slide: the width folds while the panel slides behind the list
    <div
      inert={!shown}
      onTransitionStart={(event) => event.target === event.currentTarget && setSettled(false)}
      onTransitionEnd={(event) => event.target === event.currentTarget && setSettled(shown)}
      className={cn(
        "h-full shrink-0 transition-[width] duration-200 ease-out motion-reduce:duration-[1ms] max-md:hidden",
        shown ? "w-64" : "w-0",
        !(shown && settled) && "overflow-hidden",
      )}
    >
      <nav
        aria-label={t("office.threadsAria", { name: botLabelLine(bot) })}
        className={cn(
          "flex h-full w-64 flex-col border-l border-hairline/40 bg-inset [--threads-bg:var(--color-inset)] transition-transform duration-200 ease-out motion-reduce:transition-none",
          !shown && "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 px-3 pb-1 pt-4">
          {team.length > 1 ? (
            <div className="min-w-0 flex-1">
              <SidebarPopoverMenu
                placement="below-start"
                ariaLabel={t("simpleUi.switchBot")}
                items={team.map((member) => ({
                  key: member.id,
                  label: botLabel(member).name,
                  icon: <BotAvatar bot={member} size={24} animated={false} />,
                  active: member.id === bot.id,
                // where the team row's unread dot comes from
                attention: member.id !== bot.id && unreadForMe(member),
                attentionTone: "accent",
                  onSelect: () => dispatch({ type: "select", id: member.id }),
                }))}
                renderTrigger={({ open }) => (
                  <span className="flex w-full min-w-0 items-center gap-1 rounded-lg px-1 py-1 text-left hover:bg-raised/60" title={t("simpleUi.switchBot")}>
                    {title}
                    <ChevronDown size={15} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform", open && "rotate-180")} />
                  </span>
                )}
              />
            </div>
          ) : title}
          <button
            type="button"
            onClick={() => setThreadColumn(false)}
            aria-label={t("office.hideThreads")}
            title={t("office.hideThreads")}
            className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <ChevronLeft size={17} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          <BotThreads bot={bot} onNew={() => dispatch({ type: "newTask", botId: bot.id })} />
        </div>
      </nav>
    </div>
  );
}
