// Office view (fork): find an agent by name, team or title (⌘F). The field
// grows out of the toolbar; ↑/↓ choose, Enter flies there and opens the chat.
import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { botLabel } from "@/lib/bot-label";
import { stateForBot } from "@/lib/mascot";
import { botStatus } from "@/lib/office-status";
import { searchBots } from "@/lib/office-search";
import { SimpleBotAvatar as BotAvatar } from "../SimpleBotAvatar";
import { StatusSymbol } from "./OfficeStatusRail";

export function OfficeSearch({
  open,
  onOpenChange,
  bots,
  teamOf,
  onPick,
  onWarm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bots: Bot[];
  teamOf: Map<string, string>;
  onPick: (botId: string) => void;
  /** the highlighted result: render its chat ahead of Enter */
  onWarm: (botId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const results = searchBots(bots, query, (bot) => teamOf.get(bot.id) ?? "");

  useEffect(() => {
    if (open) inputRef.current?.focus();
    else setQuery("");
  }, [open]);
  useEffect(() => setActive(0), [query]);
  const activeId = results[active]?.id;
  useEffect(() => {
    if (!activeId) return;
    const timer = setTimeout(() => onWarm(activeId), 150);
    return () => clearTimeout(timer);
  }, [activeId, onWarm]);

  // a click elsewhere closes an empty field; one with text stays
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !inputRef.current?.value) onOpenChange(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open, onOpenChange]);

  const pick = (bot: Bot | undefined) => {
    if (!bot) return;
    onOpenChange(false);
    onPick(bot.id);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        title={`${t("office.search")} (⌘F)`}
        aria-label={t("office.search")}
        className="flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
      >
        <Search size={16} />
      </button>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="flex h-8 w-60 items-center gap-1.5 rounded-full bg-raised/70 pl-2.5 pr-1">
        <Search size={14} className="shrink-0 text-ink-secondary" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(results.length - 1, index + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              pick(results[active]);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onOpenChange(false);
            }
          }}
          placeholder={t("office.searchPlaceholder")}
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls="office-search-results"
          aria-activedescendant={results[active] ? `office-search-${results[active].id}` : undefined}
          className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
        />
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={t("common.close")}
          className="flex size-6 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>

      {query.trim() && (
        <div
          id="office-search-results"
          role="listbox"
          className="absolute left-0 top-full mt-2.5 w-72 overflow-hidden rounded-2xl border border-hairline/40 bg-panel/90 p-1.5 shadow-xl shadow-black/30 backdrop-blur-xl"
        >
          {results.length === 0 ? (
            <div className="px-2.5 py-2 text-[13.5px] text-ink-secondary">{t("office.noResults")}</div>
          ) : (
            results.map((bot, index) => {
              const status = botStatus(bot);
              return (
                <button
                  key={bot.id}
                  id={`office-search-${bot.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onPointerMove={() => setActive(index)}
                  onClick={() => pick(bot)}
                  className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", index === active && "bg-raised/70")}
                >
                  <BotAvatar bot={bot} state={stateForBot(bot)} size={30} motion="none" motionKey={0} animated={false} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-semibold leading-5 text-ink">{botLabel(bot).name}</span>
                    {teamOf.get(bot.id) && <span className="block truncate text-[12.5px] leading-4 text-ink-secondary">{teamOf.get(bot.id)}</span>}
                  </span>
                  {status !== "idle" && <StatusSymbol status={status} size={14} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
