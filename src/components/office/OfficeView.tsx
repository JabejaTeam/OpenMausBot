// Office view (fork): the bot list as a 3D office. Every team works at its own
// desk; hover a bot for its name, click it to open its newest conversation in
// a side panel, switch threads from the panel header. three.js loads lazily.
import { Activity, memo, startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, List, PanelLeft, Plus, Scan, Search, X } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { MAUS_COLORS, stateForBot } from "@/lib/mascot";
import { hiddenBotsForMe, usePeople } from "@/lib/people";
import { BOTS_SECTION_ID, orderedSidebarSections, shownForMe, userSectionId } from "@/lib/sidebar-layout";
import { loadSectionOrder } from "@/lib/sidebar-preferences";
import { simpleSidebarLayout } from "@/lib/simple-ui-groups";
import { officeLayout, officeSignature, type OfficeTeam } from "@/lib/office-layout";
import { attentionThreadId, botStatus, focusTask, hasUnread, nextNeedingYou, statusGroups } from "@/lib/office-status";
import { prewarm, remember } from "@/lib/office-recent";
import { delegationLinks } from "@/lib/office-delegations";
import { setOfficeView } from "@/lib/office-view";
import { useDesktopCapabilities } from "../DesktopCapabilities";
import { ChatView } from "../ChatView";
import { BotThreadList } from "../Sidebar";
import { SimpleBotAvatar as BotAvatar } from "../SimpleBotAvatar";
import { sidebarBotActivityTasks } from "../SidebarBotActivity";
import type { OfficeBotLook, OfficeScene, OfficeTheme } from "./office-scene";
import { OfficeStatusRail, StatusSymbol } from "./OfficeStatusRail";
import { OfficeSearch } from "./OfficeSearch";

function readTheme(): OfficeTheme {
  const css = getComputedStyle(document.documentElement);
  const value = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const background = value("--color-app", "#070707");
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.fillStyle = background;
  const hex = probe.fillStyle.startsWith("#") ? probe.fillStyle : "#000000";
  const luminance = (parseInt(hex.slice(1, 3), 16) * 0.299 + parseInt(hex.slice(3, 5), 16) * 0.587 + parseInt(hex.slice(5, 7), 16) * 0.114) / 255;
  const dark = luminance < 0.5;
  return {
    background,
    floor: dark ? "#161618" : "#f2f2f7",
    pad: dark ? "#202023" : "#e5e5ea",
    desk: dark ? "#48484a" : "#ffffff",
    accent: value("--color-accent", "#1084fe"),
    success: value("--color-success", "#38d591"),
    warning: value("--color-warning", "#ff9f0a"),
    dark,
  };
}

function isWorking(bot: Bot, pendingQueued: Parameters<typeof sidebarBotActivityTasks>[1]): boolean {
  return Boolean(bot.busy) || sidebarBotActivityTasks(bot, pendingQueued).some((task) => task.busy || task.activity === "working");
}

/** Team, and what the bot is on: the thread a click opens, in its status. */
function PanelSubtitle({ bot, team }: { bot: Bot; team?: string }) {
  const { status, title } = focusTask(bot);
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-4 text-ink-secondary">
      {status !== "idle" && <StatusSymbol status={status} size={11} />}
      <span className="truncate">
        {[team, status !== "idle" ? t(`office.status.${status}`) : null, title].filter(Boolean).join(" · ")}
      </span>
    </span>
  );
}

const THREAD_COLUMN_KEY = "omb-office-thread-column";

/** Fires once its chat has committed visibly: on first render, and each
 * time a hidden (cached) chat is shown again. */
function ChatReady({ id, onReady }: { id: string; onReady: (id: string) => void }) {
  useLayoutEffect(() => onReady(id), [id, onReady]);
  return null;
}

/** The open chat, and the cached ones hidden beside it. Memoised: the office
 * re-renders on every hover, the chats must not (they are heavy). */
const OfficeChats = memo(function OfficeChats({ bots, openId, onReady }: { bots: Bot[]; openId: string | null; onReady: (id: string) => void }) {
  return bots.map((bot) => (
    <Activity key={bot.id} mode={bot.id === openId ? "visible" : "hidden"}>
      <div className="flex min-h-0 min-w-0 flex-1 [&_[data-simple-header]]:hidden">
        <ChatView bot={bot} />
        <ChatReady id={bot.id} onReady={onReady} />
      </div>
    </Activity>
  ));
});

export function OfficeView() {
  const { state, dispatch } = useStore();
  usePeople();
  const { capabilities } = useDesktopCapabilities();
  const hostRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef(new Map<string, HTMLElement>());
  const sceneRef = useRef<OfficeScene | null>(null);
  const [sceneReady, setSceneReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // open as asked; the scene slides the panel in after it mounts, out before it unmounts
  const [shown, setShown] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  // Chats stay rendered (hidden) for the last few bots, and one you hover is
  // rendered ahead; all of it in transitions, so the flight never stutters.
  const [recent, setRecent] = useState<string[]>([]);
  // phones: the thread list as a popover; wider: a column beside the chat
  const [threadsOpen, setThreadsOpen] = useState(false);
  const [threadColumn, setThreadColumnState] = useState(() => {
    try {
      return localStorage.getItem(THREAD_COLUMN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const setThreadColumn = (shown: boolean) => {
    setThreadColumnState(shown);
    try {
      localStorage.setItem(THREAD_COLUMN_KEY, shown ? "1" : "0");
    } catch {
      // the choice still holds for this session
    }
  };
  const [searchOpen, setSearchOpen] = useState(false);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;

  // Same teams, order and visibility as the Simple UI list
  const hiddenForMe = hiddenBotsForMe();
  const bots = state.bots.filter((bot) => shownForMe(bot, hiddenForMe, ""));
  const grouped = simpleSidebarLayout(bots, [], state.sections ?? []);
  const idOf = (section?: string) => (section ? userSectionId(section) : BOTS_SECTION_ID);
  const order = orderedSidebarSections(grouped.groups.map((group) => idOf(group.section)), loadSectionOrder());
  const teams: OfficeTeam[] = [...grouped.groups]
    .sort((a, b) => order.indexOf(idOf(a.section)) - order.indexOf(idOf(b.section)))
    .map((group) => ({ id: group.id, label: group.section ?? t("simpleUi.unassigned"), bots: group.bots }));
  const hero: OfficeTeam | null = grouped.hero ? { id: "hero", label: grouped.hero.name, bots: [grouped.hero] } : null;
  const signature = officeSignature(teams, hero);
  // the signature is the layout's identity
  const layout = useMemo(() => officeLayout(teams, hero), [signature]);
  const teamOf = new Map<string, string>();
  for (const team of teams) for (const bot of team.bots) teamOf.set(bot.id, team.label);

  const looks = new Map<string, OfficeBotLook>();
  for (const bot of bots) {
    looks.set(bot.id, {
      name: bot.name,
      color: MAUS_COLORS[bot.color] ?? MAUS_COLORS.blue,
      working: isWorking(bot, state.pendingQueued),
      waiting: botStatus(bot) === "waiting",
      unread: hasUnread(bot),
    });
  }
  const looksKey = [...looks].map(([id, look]) => `${id}:${look.color}:${look.working ? 1 : 0}${look.waiting ? 1 : 0}${look.unread ? 1 : 0}`).join("|");
  // the rail lists bots in the office's own order: the hero, then team by team
  const officeBots = [...(hero?.bots ?? []), ...teams.flatMap((team) => team.bots)] as Bot[];
  const groups = statusGroups(officeBots);
  // who works for whom right now: arcs between the desks
  const links = delegationLinks(officeBots, Date.now());
  const linksKey = links.map((link) => `${link.id}:${link.at}:${link.active ? 1 : 0}`).join("|");
  const linksRef = useRef(links);
  linksRef.current = links;
  const looksRef = useRef(looks);
  looksRef.current = looks;

  /** Fly to a bot and open it. `keepThread`: the bot was picked elsewhere
   * (⌘K, a notification) with its thread already chosen — keep that one. */
  const open = (botId: string, keepThread = false) => {
    const bot = state.bots.find((item) => item.id === botId);
    if (!bot) return;
    if (!keepThread) {
      const threadId = attentionThreadId(bot);
      if (threadId !== bot.threadId) dispatch({ type: "switchTask", botId, threadId });
      else dispatch({ type: "select", id: botId });
    }
    setOpenId(botId);
    setThreadsOpen(false);
    // Render first, then move: the chat commits before any animation starts
    // (a render during a move is what makes it stutter). A cached or warmed
    // chat commits at once. ChatReady below starts the move.
    setRecent((ids) => remember(ids, botId));
    if (shown && botId === openId) return;
    pendingMove.current = { botId, panel: !shown };
    // all state for the move is set now, before it starts: a state change
    // during the move re-renders the chat and makes it stutter
    if (!shown) setShown(true);
    clearTimeout(moveFallback.current);
    // reopened while sliding out: its chat is on screen already
    if (botId === openId) startMove(botId);
    else moveFallback.current = setTimeout(() => startMove(botId), 400);
  };
  const pendingMove = useRef<{ botId: string; panel: boolean } | null>(null);
  const moveFallback = useRef<ReturnType<typeof setTimeout>>(undefined);
  const startMove = (botId: string) => {
    const move = pendingMove.current;
    if (!move || move.botId !== botId) return;
    pendingMove.current = null;
    clearTimeout(moveFallback.current);
    // one frame later, so the chat's first paint is out of the way
    requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!move.panel) return sceneRef.current?.focusBot(botId);
      if (!panel) return;
      if (sceneRef.current) sceneRef.current.openPanel(panel, botId);
      else panel.style.transform = "none";
    });
  };
  const startMoveRef = useRef(startMove);
  startMoveRef.current = startMove;
  const onChatReady = useMemo(() => (id: string) => startMoveRef.current(id), []);
  const warm = (botId: string) => startTransition(() => setRecent((ids) => prewarm(ids, botId, openIdRef.current)));
  const warmRef = useRef(warm);
  warmRef.current = warm;
  const warmStable = useMemo(() => (botId: string) => warmRef.current(botId), []);
  const close = () => {
    setShown(false);
    setThreadsOpen(false);
    if (sceneRef.current) sceneRef.current.closePanel(() => setOpenId(null));
    else setOpenId(null);
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const openRef = useRef(open);
  openRef.current = open;

  // A bot chosen outside the office (⌘K, a notification) opens here too.
  const seenSelection = useRef(state.selectedId);
  useEffect(() => {
    if (state.selectedId === seenSelection.current) return;
    const first = !seenSelection.current;
    seenSelection.current = state.selectedId;
    // the selection restored while the app loads is not a new pick
    if (!first && state.selectedId && state.selectedId !== openId && officeBots.some((bot) => bot.id === state.selectedId)) {
      openRef.current(state.selectedId, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the selection changes
  }, [state.selectedId]);

  // ⌘F always finds an agent, chat open or not; finding inside the chat is
  // the panel header's search button. ⌥↑/⌥↓ step to the previous/next agent.
  const orderRef = useRef(officeBots);
  orderRef.current = officeBots;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f") {
        // the header button's own ⌘F, meant for the chat's find bar
        if ((event as KeyboardEvent & { officeChatFind?: boolean }).officeChatFind) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        setSearchOpen(true);
        return;
      }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && openIdRef.current) {
        // in a text field only while it is empty (⌥↑/↓ move the caret otherwise)
        const field = target?.closest<HTMLElement>("input, textarea, [contenteditable='true']");
        if (field && ((field as HTMLInputElement).value ?? field.textContent ?? "").length > 0) return;
        const order = orderRef.current;
        const index = order.findIndex((bot) => bot.id === openIdRef.current);
        const next = order[(index + (event.key === "ArrowDown" ? 1 : -1) + order.length) % order.length];
        if (next) {
          event.preventDefault();
          openRef.current(next.id);
        }
      }
    };
    // capture: runs before the chat's own ⌘F listener
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // the scene lives as long as the view
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let scene: OfficeScene | null = null;
    import("./office-scene")
      .then(({ OfficeScene }) => {
        if (disposed) return;
        scene = new OfficeScene(host, readTheme(), {
          onHover: setHovered,
          onPick: (botId) => openRef.current(botId),
          onPickDesk: (deskId) => scene?.focusDesk(deskId),
        });
        sceneRef.current = scene;
        setSceneReady(true);
      })
      .catch(() => setFailed(true));
    return () => {
      disposed = true;
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (sceneReady) sceneRef.current?.setLayout(layout, looksRef.current);
  }, [sceneReady, layout]);
  useEffect(() => {
    if (sceneReady) sceneRef.current?.setLooks(looksRef.current);
  }, [sceneReady, looksKey]);
  useEffect(() => {
    if (sceneReady) sceneRef.current?.setLinks(linksRef.current);
  }, [sceneReady, linksKey, layout]);
  useEffect(() => {
    sceneRef.current?.setOverlays(labelRefs.current, hoverRef.current);
  });
  useEffect(() => {
    sceneRef.current?.setSelected(openId);
  }, [sceneReady, openId]);
  // resting on a bot for a moment renders its chat ahead of the click
  useEffect(() => {
    if (!hovered) return;
    const timer = setTimeout(() => warmRef.current(hovered), 150);
    return () => clearTimeout(timer);
  }, [hovered]);

  const openBot = openId ? state.bots.find((bot) => bot.id === openId) : undefined;
  useEffect(() => {
    if (!openBot) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (threadsOpen) setThreadsOpen(false);
      else closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openBot, threadsOpen]);


  // picking a thread from the list closes it
  const openThreadId = openBot?.threadId;
  useEffect(() => setThreadsOpen(false), [openThreadId]);

  const hoveredBot = hovered ? state.bots.find((bot) => bot.id === hovered) : undefined;
  // only a new chat list re-renders the chats (not hover, not the camera)
  const cachedBots = useMemo(() => recent.flatMap((id) => state.bots.find((bot) => bot.id === id) ?? []), [recent, state.bots]);
  const next = openId ? nextNeedingYou(officeBots, openId) : null;
  const macInset = capabilities.windowChrome === "mac-inset";
  const glass = "bg-panel/80 shadow-lg shadow-black/20 backdrop-blur-xl";

  return (
    // overflow-clip, never overflow-hidden: the panel waits off-screen to the
    // right, and when its chat focuses the composer the browser would scroll
    // a hidden-overflow box sideways to show it — the whole office jumps.
    // clip cannot be scrolled at all.
    <main className="relative flex h-full min-w-0 flex-1 overflow-clip bg-app" data-office-view>
      <div className="relative min-w-0 flex-1 overflow-clip">
        <div ref={hostRef} className="absolute inset-0" aria-label={t("office.aria")} role="application" />

        {/* team names over each desk; click flies there */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {layout.desks.map((desk) => (
            <button
              key={desk.id}
              type="button"
              ref={(element) => {
                if (element) labelRefs.current.set(desk.id, element);
                else labelRefs.current.delete(desk.id);
              }}
              onClick={() => sceneRef.current?.focusDesk(desk.id)}
              style={{ visibility: "hidden" }}
              className="pointer-events-auto absolute left-0 top-0 whitespace-nowrap rounded-full px-3 py-1 text-[13px] font-medium text-ink-secondary transition-colors hover:bg-panel/70 hover:text-ink"
            >
              {desk.label}
            </button>
          ))}
          {/* the hovered bot's name, above its head */}
          <div ref={hoverRef} style={{ visibility: "hidden" }} className="absolute left-0 top-0 pb-1.5" aria-hidden={!hoveredBot}>
            {hoveredBot && (
              <div className={cn("flex items-center gap-2 rounded-full py-1 pl-1 pr-3", glass)} role="tooltip">
                <BotAvatar bot={hoveredBot} state={stateForBot(hoveredBot)} size={22} motion="none" motionKey={0} animated={false} />
                <span className="text-[13.5px] font-semibold text-ink">{hoveredBot.name}</span>
                {teamOf.get(hoveredBot.id) && <span className="text-[12.5px] text-ink-secondary">{teamOf.get(hoveredBot.id)}</span>}
                {botStatus(hoveredBot) !== "idle" && (
                  <span className="flex items-center gap-1.5 text-[12.5px] text-ink-secondary">
                    <StatusSymbol status={botStatus(hoveredBot) as "waiting" | "working" | "unread"} size={12} />
                    {t(`office.status.${botStatus(hoveredBot)}`)}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className={cn("absolute top-3 flex items-center gap-1 rounded-full p-1", glass, macInset ? "left-20" : "left-3")}>
          <button
            type="button"
            onClick={() => setOfficeView(false)}
            title={t("office.showList")}
            aria-label={t("office.showList")}
            className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <List size={17} />
          </button>
          <button
            type="button"
            onClick={() => sceneRef.current?.fitAll()}
            title={t("office.overview")}
            aria-label={t("office.overview")}
            className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
          >
            <Scan size={16} />
          </button>
          <OfficeSearch open={searchOpen} onOpenChange={setSearchOpen} bots={officeBots} teamOf={teamOf} onPick={(botId) => openRef.current(botId)} onWarm={warmStable} />
        </div>

        <OfficeStatusRail groups={groups} teamOf={teamOf} onPick={(botId) => openRef.current(botId)} onWarm={warmStable} glass={glass} />

        {(failed || !sceneReady) && (
          <div className="absolute inset-0 flex items-center justify-center text-[14px] text-ink-secondary">
            {failed ? t("office.failed") : null}
          </div>
        )}
      </div>

      {/* Always mounted, off-screen when closed, so the cached chats survive */}
      <aside
        ref={panelRef}
        data-office-panel
        aria-label={openBot?.name}
        aria-hidden={!openBot}
        inert={!openBot}
        style={{ transform: "translateX(100%)" }}
        className={cn(
          "absolute inset-y-0 right-0 z-30 flex flex-col border-l border-hairline/40 bg-app shadow-2xl shadow-black/40 will-change-transform max-md:w-full",
          threadColumn ? "w-[min(820px,100%)]" : "w-[min(560px,100%)]",
        )}
      >
        {openBot && (
          <div className="flex items-center gap-2 px-3 pb-1 pt-3">
            <button
              type="button"
              onClick={() => dispatch({ type: "toggleSettings", open: true })}
              title={t("chat.openProfile")}
              className="flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 hover:bg-raised/60"
            >
              <BotAvatar bot={openBot} state={stateForBot(openBot)} size={28} />
              <span className="min-w-0 text-left">
                <span className="block truncate text-[15px] font-semibold leading-5 text-ink">{openBot.name}</span>
                <PanelSubtitle bot={openBot} team={teamOf.get(openBot.id)} />
              </span>
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {next && (
                <button
                  type="button"
                  onClick={() => open(next.bot.id)}
                  title={t("office.nextTitle", { name: next.bot.name })}
                  className="flex h-8 items-center gap-0.5 rounded-full bg-raised/50 pl-3 pr-2 text-[13.5px] text-ink hover:bg-raised"
                >
                  {t("office.next")}
                  <span className="ml-1 text-[12px] tabular-nums text-ink-secondary">{next.count}</span>
                  <ChevronRight size={15} className="text-ink-secondary" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (globalThis.matchMedia?.("(min-width: 768px)").matches) setThreadColumn(!threadColumn);
                  else setThreadsOpen((value) => !value);
                }}
                aria-pressed={threadColumn}
                title={t(threadColumn ? "office.hideThreads" : "office.showThreads")}
                aria-label={t(threadColumn ? "office.hideThreads" : "office.showThreads")}
                className={cn("flex size-8 items-center justify-center rounded-full hover:bg-raised hover:text-ink", threadColumn ? "text-ink" : "text-ink-secondary")}
              >
                <PanelLeft size={17} />
              </button>
              <button
                type="button"
                onClick={() => {
                  // ChatView opens its find bar on ⌘F; send it one marked as ours
                  const find = new KeyboardEvent("keydown", { key: "f", metaKey: true, ctrlKey: !/Mac|iPhone|iPad/.test(navigator.platform), bubbles: true });
                  Object.assign(find, { officeChatFind: true });
                  window.dispatchEvent(find);
                }}
                title={t("office.findInChat")}
                aria-label={t("office.findInChat")}
                className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
              >
                <Search size={16} />
              </button>
              <button
                type="button"
                onClick={() => { setThreadsOpen(false); dispatch({ type: "newTask", botId: openBot.id }); }}
                title={t("task.newShort")}
                aria-label={t("task.newShort")}
                className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
              >
                <Plus size={17} />
              </button>
              <button
                type="button"
                onClick={close}
                title={t("common.close")}
                aria-label={t("common.close")}
                className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
              >
                <X size={17} />
              </button>
            </div>
          </div>
        )}
        {openBot && threadsOpen && (
          <div className={cn("absolute inset-x-3 top-14 z-20 max-h-[60%] overflow-y-auto rounded-2xl border border-hairline/40 bg-panel p-2 md:hidden", "shadow-xl shadow-black/30")}>
            <BotThreadList bot={openBot} selected density="comfortable" />
          </div>
        )}
        <div className="flex min-h-0 flex-1">
          {/* the bot's threads, one tap to switch — the sidebar's own list */}
          {openBot && threadColumn && (
            <nav aria-label={t("office.threadsAria", { name: openBot.name })} className="hidden w-60 shrink-0 overflow-y-auto border-r border-hairline/40 px-2 pb-3 pt-1 md:block">
              <BotThreadList bot={openBot} selected density="comfortable" />
            </nav>
          )}
          {/* the open chat shows; the others stay rendered, hidden, for an instant switch */}
          <OfficeChats bots={cachedBots} openId={openId} onReady={onChatReady} />
        </div>
      </aside>
    </main>
  );
}
