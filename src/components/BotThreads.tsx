// Fork: a bot's threads as Messages lists conversations — a search field and
// a compose button on top, then every thread in one scrolling list. Shown in
// the office panel and in the Simple UI's thread column; whether that column
// shows is one choice for both (useThreadColumn).
import { useState, useSyncExternalStore } from "react";
import { Search, SquarePen } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { BotThreadList, botRowProps } from "./Sidebar";

const THREAD_COLUMN_KEY = "omb-office-thread-column";
let shownChoice: boolean | undefined;
const listeners = new Set<() => void>();

function readShown(): boolean {
  if (shownChoice !== undefined) return shownChoice;
  try {
    return localStorage.getItem(THREAD_COLUMN_KEY) !== "0";
  } catch {
    return true;
  }
}

export function setThreadColumn(shown: boolean): void {
  shownChoice = shown;
  try {
    localStorage.setItem(THREAD_COLUMN_KEY, shown ? "1" : "0");
  } catch {
    // the choice still holds for this session
  }
  for (const listener of listeners) listener();
}

/** Whether the thread column shows beside the bot list (and the office chat). */
export function useThreadColumn(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    readShown,
    readShown,
  );
}

export function BotThreads({ bot, onNew }: { bot: Bot; onNew: () => void }) {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  return (
    <>
      <div className="sticky top-0 z-10 flex items-center gap-1 bg-app pb-1.5 pt-1">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-inset px-2 text-ink-secondary">
          <Search size={14} className="shrink-0" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape" && query) { event.stopPropagation(); setQuery(""); } }}
            placeholder={t("sidebar.search")}
            aria-label={t("task.search")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={onNew}
          title={t("task.newShort")}
          aria-label={t("task.newShort")}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <SquarePen size={16} />
        </button>
      </div>
      <BotThreadList {...botRowProps(state, dispatch, bot, { density: "comfortable", quiet: false, query, onMenu: () => undefined })} selected everything />
    </>
  );
}
