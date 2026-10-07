// Jabeja fork: the channel picker on top of the office's thread column
// (src/lib/thread-channel.ts). A popup button, as a Mac toolbar has one:
// My conversations, Team, then each teammate who has conversations here.
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { usePrivateThreads } from "@/lib/cloud-guest";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { personName, usePeople } from "@/lib/people";
import { setThreadChannel, useThreadChannel, type ThreadChannel } from "@/lib/thread-channel";
import { useStore } from "@/state/store";

export function ThreadChannelPicker() {
  const privateThreads = usePrivateThreads();
  const channel = useThreadChannel();
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  usePeople();

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const people = [...new Set(state.bots.flatMap((bot) => (bot.tasks ?? [])
    .filter((task) => task.access && task.access !== "own" && task.person)
    .map((task) => task.person!)))]
    .map((key) => ({ key, name: personName(key) ?? t("chat.share.someone") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const options: { value: ThreadChannel; label: string }[] = [
    { value: "mine", label: t("chat.channel.mine") },
    { value: "team", label: t("chat.channel.team") },
    ...people.map((person) => ({ value: `person:${person.key}` as ThreadChannel, label: person.name })),
  ];
  const current = options.find((option) => option.value === channel) ?? options[0]!;
  // A teammate whose conversations are gone: back to the default.
  useEffect(() => { if (privateThreads && state.bots.length > 0 && current.value !== channel) setThreadChannel(current.value); }, [privateThreads, state.bots.length, current.value, channel]);
  if (!privateThreads) return null;
  const pick = (value: ThreadChannel) => { setThreadChannel(value); setOpen(false); };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-testid="thread-channel"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-7 max-w-full items-center gap-1 rounded-md px-1.5 text-[13px] font-semibold text-ink hover:bg-raised"
      >
        <span className="truncate">{current.label}</span>
        <ChevronDown size={14} className={cn("shrink-0 text-ink-secondary transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-hairline/60 bg-raised p-1 shadow-lg shadow-black/30">
          {options.map((option, index) => (
            <div key={option.value}>
              {index === 2 && <div className="mx-2 my-1 h-px bg-hairline/60" />}
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.value === current.value}
                onClick={() => pick(option.value)}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-inset"
              >
                <span className="truncate">{option.label}</span>
                {option.value === current.value && <Check size={15} className="shrink-0 text-accent" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
