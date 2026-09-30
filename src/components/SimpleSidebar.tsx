// Simple UI (fork): the one-list sidebar — chief on top, bots and rooms
// filed by lib/simple-ui-groups, profile and connected apps at the bottom.
// No density, sections menu, threads or tools rows: those stay in the full UI.
import { useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { useStore, type Bot, type Group } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { stateForBot } from "@/lib/mascot";
import { hiddenBotsForMe, usePeople } from "@/lib/people";
import { shownForMe } from "@/lib/sidebar-layout";
import { simpleSidebarLayout, type SimpleGroup } from "@/lib/simple-ui-groups";
import { InitialsAvatar } from "./Avatar";
import { SimpleBotAvatar as BotAvatar } from "./SimpleBotAvatar";
import { useDesktopCapabilities } from "./DesktopCapabilities";
import { groupPreview, preview } from "./Sidebar";
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
  onClick,
}: {
  selected: boolean;
  unread?: boolean;
  avatar: React.ReactNode;
  name: string;
  sub: string;
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
        <span className="block truncate text-[13.5px] leading-5 text-ink-secondary">{sub || " "}</span>
      </span>
      {unread && <span className="size-2 shrink-0 rounded-full bg-accent" aria-label={t("task.unread")} />}
    </button>
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
  const { hero, groups } = simpleSidebarLayout(bots, rooms, state.sections ?? []);
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
        {hero && (
          <button
            type="button"
            onClick={() => select(hero.id)}
            className="mx-auto mb-2 mt-1 flex flex-col items-center gap-1.5 rounded-2xl px-4 py-2 hover:bg-raised/40"
          >
            <span className="relative">
              <BotAvatar bot={hero} state={stateForBot(hero)} size={76} />
              {hero.unread && <span className="absolute right-0 top-1 size-2.5 rounded-full bg-accent" />}
            </span>
            <span className={cn("text-[13px] font-medium", chatView && state.selectedId === hero.id ? "text-ink" : "text-ink-secondary")}>
              {hero.name}
            </span>
          </button>
        )}
        {groups.map((group) => (
          <section key={group.id} className="mt-3">
            <div className="px-2.5 pb-1.5 text-[13.5px] text-ink-secondary">{groupLabel(group)}</div>
            {group.bots.map((bot) => (
              <Row
                key={bot.id}
                selected={chatView && state.selectedId === bot.id}
                unread={bot.unread}
                avatar={<BotAvatar bot={bot} state={stateForBot(bot)} size={40} />}
                name={bot.name}
                sub={preview(bot)}
                onClick={() => select(bot.id)}
              />
            ))}
            {group.rooms.map((room) => (
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
          </section>
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
          className="flex h-10 items-center gap-2 rounded-full border border-hairline/40 bg-app/40 pl-4 pr-3 text-[14px] text-ink hover:bg-raised"
        >
          {t("simpleUi.connectApps")}
          <GmailMark />
        </button>
      </div>
    </aside>
  );
}
