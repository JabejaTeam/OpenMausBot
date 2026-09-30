// Simple UI (fork): the one-list sidebar — chief on top, bots and rooms
// filed by lib/simple-ui-groups, profile and connected apps at the bottom.
// Threads: hovering a bot shows the thread list toggle and a new-thread button;
// active and unread threads always show under the bot. Teams reorder by drag,
// sharing the saved order with the full sidebar.
import { useRef, useState } from "react";
import { ChevronDown, Plus, Search, X } from "lucide-react";
import { useStore, type Bot, type Group } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { stateForBot } from "@/lib/mascot";
import { hiddenBotsForMe, usePeople } from "@/lib/people";
import {
  BOTS_SECTION_ID,
  mergeSectionOrder,
  orderedSidebarSections,
  placeSection,
  sameSectionOrder,
  shownForMe,
  userSectionId,
  type SectionDropPlace,
} from "@/lib/sidebar-layout";
import { loadCollapsedSections, loadSectionOrder, saveCollapsedSections, saveSectionOrder, toggleCollapsedSection } from "@/lib/sidebar-preferences";
import { simpleSidebarLayout, type SimpleGroup } from "@/lib/simple-ui-groups";
import { InitialsAvatar } from "./Avatar";
import { SimpleBotAvatar as BotAvatar } from "./SimpleBotAvatar";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { BotThreadList, groupPreview, preview } from "./Sidebar";
import { SidebarBotActivity, sidebarBotActivityTasks } from "./SidebarBotActivity";
import { WorkingDots } from "./WorkingIndicator";
import { profileInitials } from "./SidebarProfileMenu";

function groupLabel(group: SimpleGroup<Bot, Group>): string {
  return group.section ?? t("simpleUi.unassigned");
}

function Row({
  selected,
  unread,
  avatar,
  name,
  sub,
  subNode,
  onClick,
  padRight = false,
}: {
  selected: boolean;
  unread?: boolean;
  avatar: React.ReactNode;
  name: string;
  sub: string;
  subNode?: React.ReactNode;
  onClick: () => void;
  /** room for hover buttons on the right */
  padRight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors",
        padRight && "group-hover:pr-[4.5rem] group-focus-within:pr-[4.5rem] max-md:pr-[4.5rem]",
        selected ? "bg-raised" : "hover:bg-raised/50",
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center">{avatar}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{name}</span>
        {subNode ?? <span className="block truncate text-[13.5px] leading-5 text-ink-secondary">{sub || " "}</span>}
      </span>
      {unread && <span className={cn("size-2 shrink-0 rounded-full bg-accent", padRight && "group-hover:hidden group-focus-within:hidden")} aria-label={t("task.unread")} />}
    </button>
  );
}

/** A bot row: Grok look, plus the full sidebar's threads — a hover toggle
 * for the whole list and a new-thread button; active/unread threads below. */
function BotRow({ bot, query }: { bot: Bot; query: string }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  const activity = sidebarBotActivityTasks(bot, state.pendingQueued);
  const working = Boolean(bot.busy) || activity.some((task) => task.busy || task.activity === "working");
  const unread = Boolean(bot.unread) || activity.some((task) => task.unread);
  const hasThreadList = (bot.tasks?.filter((task) => !task.routineRunId).length ?? 1) > 1 || (bot.projects?.length ?? 0) > 0;
  const hover = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-70";
  return (
    <>
      <div className="group relative">
        <Row
          selected={selected}
          unread={unread}
          avatar={
            <span className="relative flex">
              <BotAvatar bot={bot} state={working ? stateForBot(bot) : "happy"} size={40} animated={working} />
              {working && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-panel bg-success" />}
            </span>
          }
          name={bot.name}
          sub={working ? "" : preview(bot)}
          subNode={working ? <span className="flex h-5 items-center" role="status"><WorkingDots size={3.5} /></span> : undefined}
          onClick={() => dispatch({ type: "select", id: bot.id })}
          padRight
        />
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
          <button
            type="button"
            aria-label={t("task.newShort")}
            title={t("task.newShort")}
            onClick={() => { setOpen(true); dispatch({ type: "newTask", botId: bot.id }); }}
            className={cn("flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink", hover)}
          >
            <Plus size={15} />
          </button>
          {hasThreadList && (
            <button
              type="button"
              aria-label={t(open ? "task.collapseNamed" : "task.expandNamed", { name: bot.name })}
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className={cn("flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink", !open && hover)}
            >
              <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
      {open && hasThreadList
        ? <div className="pl-10"><BotThreadList bot={bot} selected={selected} density="comfortable" query={query} /></div>
        : <div className="pl-10"><SidebarBotActivity bot={bot} density="comfortable" /></div>}
    </>
  );
}

/** The unsectioned chief, big on top; same thread controls as a bot row. */
function HeroBot({ bot, query }: { bot: Bot; query: string }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const selected = state.activeView === "chat" && state.selectedId === bot.id;
  const activity = sidebarBotActivityTasks(bot, state.pendingQueued);
  const working = Boolean(bot.busy) || activity.some((task) => task.busy || task.activity === "working");
  const unread = Boolean(bot.unread) || activity.some((task) => task.unread);
  const hasThreadList = (bot.tasks?.filter((task) => !task.routineRunId).length ?? 1) > 1 || (bot.projects?.length ?? 0) > 0;
  const hover = "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-70";
  const small = "flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink";
  return (
    <div className="mb-2">
      <div className="group relative flex justify-center">
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
          <span className={cn("text-[13px] font-medium", selected ? "text-ink" : "text-ink-secondary")}>{bot.name}</span>
        </button>
        <div className="absolute right-2 top-1/2 flex -translate-y-1/2 flex-col items-center gap-0.5">
          <button type="button" aria-label={t("task.newShort")} title={t("task.newShort")}
            onClick={() => { setOpen(true); dispatch({ type: "newTask", botId: bot.id }); }} className={cn(small, hover)}>
            <Plus size={15} />
          </button>
          {hasThreadList && (
            <button type="button" aria-label={t(open ? "task.collapseNamed" : "task.expandNamed", { name: bot.name })} aria-expanded={open}
              onClick={() => setOpen((value) => !value)} className={cn(small, !open && hover)}>
              <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
      {open && hasThreadList
        ? <BotThreadList bot={bot} selected={selected} density="comfortable" query={query} />
        : <SidebarBotActivity bot={bot} density="comfortable" />}
    </div>
  );
}

/** The Gmail "M" beside Connect apps, drawn inline (no remote logo fetch). */
function GmailMark() {
  return (
    <svg width="18" height="14" viewBox="0 0 24 18" aria-hidden="true">
      <path fill="#4285F4" d="M1.6 18h3.8V8.7L0 4.7v11.7C0 17.3.7 18 1.6 18z" />
      <path fill="#34A853" d="M18.6 18h3.8c.9 0 1.6-.7 1.6-1.6V4.7l-5.4 4z" />
      <path fill="#FBBC04" d="M18.6 1.8v6.9l5.4-4V2.4C24 .4 21.7-.7 20.1.5z" />
      <path fill="#EA4335" d="M5.4 8.7V1.8L12 6.7l6.6-4.9v6.9L12 13.6z" />
      <path fill="#C5221F" d="M0 2.4v2.3l5.4 4V1.8L3.9.5C2.3-.7 0 .4 0 2.4z" />
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
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const hiddenForMe = hiddenBotsForMe();
  const bots = state.bots
    .filter((bot) => shownForMe(bot, hiddenForMe, q))
    .filter((bot) => !q || bot.name.toLowerCase().includes(q) || (bot.title ?? "").toLowerCase().includes(q));
  const rooms = state.groups.filter((group) => !q || group.name.toLowerCase().includes(q));
  const layout = simpleSidebarLayout(bots, rooms, state.sections ?? []);
  const hero = layout.hero;
  // Team order: the same saved order (and ids) as the full sidebar's sections
  const idOf = (group: SimpleGroup<Bot, Group>) => (group.section ? userSectionId(group.section) : BOTS_SECTION_ID);
  const [savedOrder, setSavedOrder] = useState<string[]>(() => loadSectionOrder());
  const orderedIds = orderedSidebarSections(layout.groups.map(idOf), savedOrder);
  const groups = [...layout.groups].sort((a, b) => orderedIds.indexOf(idOf(a)) - orderedIds.indexOf(idOf(b)));
  // Collapsed teams: the same saved list as the full sidebar's sections
  const [collapsedIds, setCollapsedIds] = useState<string[]>(() => loadCollapsedSections());
  const toggleTeam = (id: string) => {
    const next = toggleCollapsedSection(collapsedIds, id);
    setCollapsedIds(next);
    saveCollapsedSections(next);
  };
  const dragFrom = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; place: SectionDropPlace } | null>(null);
  const endDrag = () => {
    dragFrom.current = null;
    setDragging(null);
    setDropTarget(null);
  };
  const drop = () => {
    const from = dragFrom.current;
    if (from && dropTarget) {
      const next = placeSection(orderedIds, from, dropTarget.id, dropTarget.place);
      if (!sameSectionOrder(next, orderedIds)) {
        const merged = mergeSectionOrder(savedOrder, next);
        setSavedOrder(merged);
        saveSectionOrder(merged);
      }
    }
    endDrag();
  };
  const chatView = state.activeView === "chat";
  const select = (id: string) => dispatch({ type: "select", id });

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
        "flex h-full w-[320px] shrink-0 flex-col bg-panel",
        // same mobile drawer rules as Sidebar (see its className comment)
        "max-md:absolute max-md:inset-y-0 max-md:left-0 max-md:z-40",
        "max-md:transition-transform max-md:duration-200",
        open ? "max-md:translate-x-0" : "max-md:-translate-x-full",
      )}
    >
      <div className="flex items-center justify-between px-4 pb-1 pt-3" style={dragStyle}>
        <div className={macInset ? "w-14" : undefined} />
        <div className="flex items-center gap-2" style={noDragStyle}>
          <button
            type="button"
            onClick={() => {
              setSearching((value) => !value);
              setQuery("");
            }}
            aria-label={t("simpleUi.search")}
            title={t("simpleUi.search")}
            aria-pressed={searching}
            className={circle}
          >
            <Search size={18} />
          </button>
          <button
            type="button"
            onClick={() => dispatch({ type: "toggleNewBot", open: true })}
            aria-label={t("simpleUi.newChat")}
            title={t("simpleUi.newChat")}
            className={circle}
          >
            <Plus size={19} />
          </button>
        </div>
      </div>

      {searching && (
        <div className="mx-4 mt-2 flex items-center gap-2 rounded-full bg-raised/60 px-3 py-2">
          <Search size={15} className="text-ink-secondary" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearching(false);
                setQuery("");
              }
            }}
            placeholder={t("simpleUi.search")}
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label={t("simpleUi.clearSearch")} className="text-ink-secondary hover:text-ink">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {hero && <HeroBot bot={hero} query={q} />}
        {groups.map((group) => {
          const id = idOf(group);
          const reorderable = !q && groups.length > 1;
          // a search always shows its matches
          const collapsed = !q && collapsedIds.includes(id);
          return (
          <section
            key={group.id}
            data-simple-section={id}
            className={cn("mt-3", dragging === id && "opacity-50")}
            onDragOver={(event) => {
              if (!dragFrom.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const rect = event.currentTarget.getBoundingClientRect();
              setDropTarget({ id, place: event.clientY < rect.top + rect.height / 2 ? "before" : "after" });
            }}
            onDrop={(event) => {
              event.preventDefault();
              drop();
            }}
          >
            {dropTarget?.id === id && dropTarget.place === "before" && dragging !== id && <div className="mx-2 mb-1 h-0.5 rounded-full bg-accent" />}
            <div
              draggable={reorderable}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", id);
                dragFrom.current = id;
                setDragging(id);
              }}
              onDragEnd={endDrag}
              className="mb-1"
            >
              <button
                type="button"
                onClick={() => toggleTeam(id)}
                aria-expanded={!collapsed}
                title={reorderable ? t("simpleUi.dragTeam") : undefined}
                className={cn(
                  "group/team flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[13.5px] text-ink-secondary hover:bg-raised/70 hover:text-ink",
                  reorderable && "cursor-grab active:cursor-grabbing",
                )}
              >
                <span className="truncate">{groupLabel(group)}</span>
                {collapsed && (group.bots.some((bot) => bot.unread || bot.tasks?.some((task) => task.unread)) || group.rooms.some((room) => room.unread)) && (
                  <span className="ml-auto mr-2 size-2 shrink-0 rounded-full bg-accent" aria-label={t("task.unreadMany")} />
                )}
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 transition-transform",
                    collapsed ? "-rotate-90 opacity-100" : "opacity-0 group-hover/team:opacity-100 group-focus-visible/team:opacity-100 max-md:opacity-70",
                  )}
                />
              </button>
            </div>
            {!collapsed && group.bots.map((bot) => <BotRow key={bot.id} bot={bot} query={q} />)}
            {!collapsed && group.rooms.map((room) => (
              <Row
                key={room.id}
                selected={chatView && state.selectedId === room.id}
                unread={room.unread}
                avatar={<RoomAvatar members={state.bots.filter((bot) => room.memberIds.includes(bot.id))} />}
                name={room.name}
                sub={groupPreview(room, state.bots)}
                onClick={() => select(room.id)}
              />
            ))}
            {dropTarget?.id === id && dropTarget.place === "after" && dragging !== id && <div className="mx-2 mt-1 h-0.5 rounded-full bg-accent" />}
          </section>
          );
        })}
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
          className="flex h-10 items-center gap-2 rounded-full border border-hairline/40 bg-app/40 pl-4 pr-3 text-[14px] text-ink hover:bg-raised"
        >
          {t("simpleUi.connectApps")}
          <GmailMark />
        </button>
      </div>
    </aside>
  );
}
