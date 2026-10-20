// Jabeja fork: the instances this window shows (lib/omgevingen.ts), as a
// segmented row on top of the Advanced sidebar. Every instance stays live;
// a tab only chooses whose bots the sidebar and the chat show. A dot marks an
// instance with something unread. The Simple sidebar lists them all instead.
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { botShowsUnread } from "@/lib/bot-unread";
import { openOmgevingen, samen, setActieveOmgeving, useActieveOmgeving } from "@/lib/omgevingen";
import { useStoresByOmgeving } from "@/state/omgeving-stores";

export function OmgevingTabs() {
  const actief = useActieveOmgeving();
  const stores = useStoresByOmgeving();
  if (!samen()) return null;
  const open = openOmgevingen();
  return (
    <div role="tablist" aria-label={t("omgeving.tabs")} className="mx-3 mb-2 flex gap-0.5 rounded-lg bg-inset p-0.5">
      {open.map((omgeving) => {
        const state = stores.get(omgeving.naam)?.state;
        const unread = Boolean(state && (state.bots.some((bot) => !bot.hidden && botShowsUnread(bot)) || state.groups.some((group) => group.unread)));
        const selected = omgeving.naam === actief;
        return (
          <button
            key={omgeving.naam}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => setActieveOmgeving(omgeving.naam)}
            className={cn(
              "relative flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1 text-[12.5px] transition-colors",
              selected ? "bg-panel font-medium text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
            )}
          >
            <span className="truncate">{omgeving.titel}</span>
            {unread && !selected && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-label={t("task.unread")} />}
          </button>
        );
      })}
    </div>
  );
}
