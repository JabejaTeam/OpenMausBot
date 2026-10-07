// Jabeja fork: who sees a conversation (server/routes/fork-threads.ts).
// Shown only where conversations are split per person. The team sees every
// conversation unless its person marks it private; then they pick who else
// is in it. Everyone else sees whose conversation it is.
import { Check, Lock, Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { usePrivateThreads } from "@/lib/cloud-guest";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { api } from "@/state/store";
import { Switch } from "./SettingsPrimitives";

interface Person { key: string; email?: string; name?: string }
interface ShareView { owner: Person | null; private?: boolean; sharedWith: Person[]; candidates: Person[]; canManage: boolean }

const label = (person: Person) => person.name || person.email || t("chat.share.someone");

export function ThreadShareButton({ threadId, listed }: { threadId: string; listed: boolean }) {
  const privateThreads = usePrivateThreads();
  const [view, setView] = useState<ShareView | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setView(null);
    if (!privateThreads || !listed) return;
    let alive = true;
    void api<ShareView>(`/api/threads/${threadId}/shares`).then((next) => { if (alive) setView(next); }, () => {});
    return () => { alive = false; };
  }, [privateThreads, listed, threadId]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!view) return null;
  const shared = new Set(view.sharedWith.map((person) => person.key));
  const save = (body: { people: string[] } | { private: boolean }) => {
    setError(null);
    void api<ShareView>(`/api/threads/${threadId}/shares`, { method: "PUT", body: JSON.stringify(body) })
      .then(setView, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  };
  const toggle = (key: string) => save({ people: shared.has(key) ? [...shared].filter((other) => other !== key) : [...shared, key] });
  const ownerName = view.owner ? label(view.owner) : t("chat.share.someone");
  const Icon = view.private ? Lock : Users;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-testid="thread-share"
        onClick={() => setOpen((value) => !value)}
        title={view.private ? t("chat.share.private") : t("chat.share.team")}
        className={cn("flex items-center gap-1 rounded-md p-1.5 hover:bg-raised", open ? "text-accent" : "text-ink-secondary hover:text-ink")}
      >
        <Icon size={18} />
        {view.private && shared.size > 0 && <span className="text-[12px] tabular-nums">{shared.size}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-hairline/60 bg-raised p-2 shadow-lg shadow-black/30">
          {view.canManage ? (
            <div className="flex items-center justify-between gap-2 px-2 py-1.5 text-[13px] text-ink">
              <span className="flex items-center gap-2"><Lock size={14} className="text-ink-secondary" />{t("chat.share.privateToggle")}</span>
              <Switch checked={Boolean(view.private)} aria-label={t("chat.share.privateToggle")} onClick={() => save({ private: !view.private })} />
            </div>
          ) : null}
          <p className="px-2 pb-1 pt-0.5 text-[12px] text-ink-secondary">
            {view.canManage
              ? view.private ? t("chat.share.hint") : t("chat.share.teamHint")
              : t(view.private ? "chat.share.by" : "chat.share.ownedBy", { name: ownerName })}
          </p>
          {view.private && (view.canManage ? view.candidates : view.sharedWith).map((person) => (
            <button
              key={person.key}
              type="button"
              disabled={!view.canManage}
              onClick={() => toggle(person.key)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink enabled:hover:bg-inset"
            >
              <span className="truncate">{label(person)}</span>
              {shared.has(person.key) && <Check size={15} className="shrink-0 text-accent" />}
            </button>
          ))}
          {error && <p role="alert" className="px-2 pt-1 text-[12px] text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
