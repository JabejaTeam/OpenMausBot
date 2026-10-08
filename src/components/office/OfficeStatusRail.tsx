// Office view (fork): the status rail on the left edge — one button per
// status that has bots (waiting on you, working, unread) with a count. A
// button opens a list beside it; picking a bot flies there and opens it.
import { useEffect, useRef, useState } from "react";
import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { botLabel } from "@/lib/bot-label";
import { stateForBot } from "@/lib/mascot";
import type { OfficeStatus } from "@/lib/office-status";
import { BotAvatar } from "../Avatar";

type Shown = Exclude<OfficeStatus, "idle">;
const ORDER: Shown[] = ["waiting", "working", "unread"];

/** The status as a small symbol in its system colour. */
export function StatusSymbol({ status, size = 18 }: { status: Shown; size?: number }) {
  if (status === "waiting") {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, fontSize: size * 0.72 }}
        className="flex items-center justify-center rounded-full bg-warning font-bold leading-none text-white"
      >
        !
      </span>
    );
  }
  if (status === "working") {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size, borderWidth: Math.max(2, size / 8) }}
        className="rounded-full border-success border-r-transparent animate-spin [animation-duration:1.1s] motion-reduce:animate-none"
      />
    );
  }
  return <span aria-hidden style={{ width: size * 0.55, height: size * 0.55 }} className="rounded-full bg-accent" />;
}

export function OfficeStatusRail({
  groups,
  teamOf,
  onPick,
  onWarm,
  glass,
}: {
  groups: Record<Shown, Bot[]>;
  teamOf: Map<string, string>;
  onPick: (botId: string) => void;
  /** about to be picked: render its chat ahead */
  onWarm: (botId: string) => void;
  glass: string;
}) {
  const [open, setOpen] = useState<Shown | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef(new Map<Shown, HTMLButtonElement>());
  const shown = ORDER.filter((status) => groups[status].length > 0);
  const list = open ? groups[open] : [];

  // a list that emptied closes itself
  useEffect(() => {
    if (open && !groups[open].length) setOpen(null);
  }, [open, groups]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(null);
        buttonRefs.current.get(open)?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!shown.length) return null;
  const top = open ? (buttonRefs.current.get(open)?.offsetTop ?? 0) : 0;

  return (
    <div ref={rootRef} className="absolute left-3 top-1/2 z-20 -translate-y-1/2">
      <nav aria-label={t("office.status.aria")} className={cn("flex flex-col gap-1 rounded-full p-1", glass)}>
        {shown.map((status) => (
          <button
            key={status}
            type="button"
            ref={(element) => {
              if (element) buttonRefs.current.set(status, element);
              else buttonRefs.current.delete(status);
            }}
            onClick={() => setOpen((current) => (current === status ? null : status))}
            aria-expanded={open === status}
            aria-haspopup="listbox"
            aria-label={`${t(`office.status.${status}`)}: ${groups[status].length}`}
            title={t(`office.status.${status}`)}
            className={cn(
              "flex size-11 flex-col items-center justify-center gap-0.5 rounded-full transition-colors motion-reduce:transition-none",
              open === status ? "bg-raised" : "hover:bg-raised/60",
            )}
          >
            <span className="flex size-[18px] items-center justify-center">
              <StatusSymbol status={status} />
            </span>
            <span className="text-[11px] font-semibold leading-none text-ink tabular-nums">{groups[status].length}</span>
          </button>
        ))}
      </nav>

      {open && (
        <div
          role="listbox"
          aria-label={t(`office.status.${open}`)}
          style={{ top }}
          className={cn(
            "absolute left-full ml-2 w-72 overflow-hidden rounded-2xl border border-hairline/40",
            "bg-panel/90 shadow-xl shadow-black/30 backdrop-blur-xl",
          )}
        >
          <div className="flex items-center gap-2 px-4 pb-1.5 pt-3 text-[13px] font-semibold text-ink-secondary">
            <StatusSymbol status={open} size={14} />
            {t(`office.status.${open}`)}
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-1.5 pt-0">
            {list.map((bot) => (
              <button
                key={bot.id}
                type="button"
                role="option"
                aria-selected={false}
                onPointerEnter={() => onWarm(bot.id)}
                onFocus={() => onWarm(bot.id)}
                onClick={() => {
                  setOpen(null);
                  onPick(bot.id);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-raised/60 focus-visible:bg-raised/60 focus-visible:outline-none"
              >
                <BotAvatar bot={bot} state={stateForBot(bot)} size={30} motion="none" motionKey={0} animated={false} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold leading-5 text-ink">{botLabel(bot).name}</span>
                  {teamOf.get(bot.id) && <span className="block truncate text-[12.5px] leading-4 text-ink-secondary">{teamOf.get(bot.id)}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
