// Fork: the controle card (server/controle-card.ts). One change at a time from
// the testlab: what changed and why, before and after with a thin frame round
// the change, and approve / reject (with feedback) / skip. Every click goes
// straight to jabeja-admin as the person who clicked; the bot takes no turn.
import { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, MessageSquare, RefreshCw, ScanEye } from "lucide-react";
import type { ControleLijst, ControleWijziging } from "../../shared/controle-card";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, type Message } from "@/state/store";

const BUTTON = "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors active:scale-[0.98] disabled:opacity-50";
const CHIP = "rounded-full bg-control px-2 py-0.5 text-[11px] text-ink-secondary";

function Beeld({ wijziging, weergave }: { wijziging: ControleWijziging; weergave: "voor" | "na" }) {
  const src = weergave === "voor" && wijziging.voorUrl ? wijziging.voorUrl : wijziging.naUrl;
  const kader = weergave === "na" ? wijziging.kader : null;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block max-h-[420px] overflow-auto rounded-lg border border-hairline/50 bg-panel/40">
      <span className="relative block">
        <img src={src} alt={wijziging.titel} className="block w-full" />
        {kader && (
          <span
            aria-hidden
            className="pointer-events-none absolute rounded-sm border-2 border-amber-500"
            style={{
              left: `${(kader.x / kader.breedte) * 100}%`,
              top: `${(kader.y / kader.hoogte) * 100}%`,
              width: `${(kader.b / kader.breedte) * 100}%`,
              height: `${(kader.h / kader.hoogte) * 100}%`,
            }}
          />
        )}
      </span>
    </a>
  );
}

export function ControleCard({ botId, threadId }: { botId: string; threadId: string; message: Message }) {
  const [lijst, setLijst] = useState<ControleLijst | null>(null);
  const [laadFout, setLaadFout] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [weergave, setWeergave] = useState<"voor" | "na">("na");
  const [afkeuren, setAfkeuren] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [melding, setMelding] = useState<string | null>(null);
  const [totaal, setTotaal] = useState(0);

  const laad = useCallback(async () => {
    setLaadFout(null);
    try {
      const data = await api<ControleLijst>(`/api/bots/${encodeURIComponent(botId)}/controle/wijzigingen`, {
        method: "POST",
        body: JSON.stringify({ threadId }),
        timeoutMs: 25_000,
      });
      setLijst(data);
      setTotaal(data.wijzigingen.length);
      setIndex(0);
    } catch (failure) {
      setLaadFout(failure instanceof Error ? failure.message : String(failure));
    }
  }, [botId, threadId]);

  useEffect(() => {
    void laad();
  }, [laad]);

  const huidig = lijst?.wijzigingen[index];

  const volgende = (tekst: string | null, weg: boolean) => {
    setMelding(tekst);
    setAfkeuren(false);
    setFeedback("");
    setFout(null);
    setWeergave("na");
    if (!lijst) return;
    if (weg) {
      const rest = lijst.wijzigingen.filter((_, i) => i !== index);
      setLijst({ ...lijst, wijzigingen: rest });
      if (index >= rest.length) setIndex(0);
    } else {
      setIndex((i) => (i + 1) % lijst.wijzigingen.length);
    }
  };

  const besluit = async (keuze: "goed" | "fout") => {
    if (!huidig) return;
    if (keuze === "fout" && !feedback.trim()) {
      setFout(t("controle.card.feedbackRequired"));
      return;
    }
    setBezig(true);
    setFout(null);
    try {
      await api(`/api/bots/${encodeURIComponent(botId)}/controle/besluit`, {
        method: "POST",
        body: JSON.stringify({ threadId, beeldIds: huidig.beeldIds, besluit: keuze, ...(keuze === "fout" ? { feedback: feedback.trim() } : {}) }),
        timeoutMs: 25_000,
      });
      volgende(keuze === "goed" ? t("controle.card.approved") : t("controle.card.rejected"), true);
    } catch (failure) {
      setFout(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBezig(false);
    }
  };

  const onKey = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === "TEXTAREA" || !huidig?.voorUrl) return;
    if (event.key === "ArrowLeft") setWeergave("voor");
    if (event.key === "ArrowRight") setWeergave("na");
  };

  return (
    <div className="flex w-full justify-start">
      <div tabIndex={0} onKeyDown={onKey} className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-hairline/50 bg-card shadow-sm outline-none">
        <div className="flex items-center gap-2.5 border-b border-hairline/40 px-4 py-3">
          <ScanEye size={15} className="text-ink-secondary" aria-hidden />
          <span className="text-[13.5px] font-semibold text-ink">{t("controle.card.title")}</span>
          {lijst && huidig && (
            <span className="ml-auto text-[12px] text-ink-secondary">
              {t("controle.card.progress", { n: String(totaal - lijst.wijzigingen.length + index + 1), total: String(totaal) })}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-3 px-4 py-3.5">
          {!lijst && !laadFout && (
            <div className="flex items-center gap-2 text-[13px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" aria-hidden /> {t("controle.card.loading")}
            </div>
          )}
          {laadFout && (
            <div className="flex items-center gap-2 text-[13px] text-danger">
              {t("controle.card.loadError")}
              <button type="button" className={cn(BUTTON, "bg-control text-ink hover:bg-control/80")} onClick={() => void laad()}>
                <RefreshCw size={12} className="mr-1 inline" aria-hidden />
                {t("controle.card.retry")}
              </button>
            </div>
          )}

          {lijst && !huidig && (
            <div className="flex items-center gap-2 text-[13.5px] text-ink">
              <span className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success">
                <Check size={16} aria-hidden />
              </span>
              {t("controle.card.allDone")}
              <a href={lijst.link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-accent hover:underline">
                {t("controle.card.openAdmin")} <ExternalLink size={12} aria-hidden />
              </a>
            </div>
          )}

          {huidig && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {huidig.kaart && <span className={CHIP}>{huidig.kaart.title}</span>}
                {huidig.onverwacht && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400">{t("controle.card.notAnnounced")}</span>}
                {huidig.soort === "nieuw" && <span className={CHIP}>{t("controle.card.newPage")}</span>}
              </div>
              <div>
                <div className="text-[15px] font-semibold text-ink">{huidig.titel}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {huidig.schermen.map((s) => <span key={s} className={CHIP}>{s}</span>)}
                </div>
              </div>
              <div className="flex flex-col gap-0.5 text-[13px] leading-relaxed">
                <div>
                  <span className="text-ink-secondary">{t("controle.card.changed")}</span>&nbsp; {huidig.anders ?? <span className="text-ink-tertiary">{t("controle.card.noExplanation")}</span>}
                </div>
                {huidig.kaart && (
                  <div>
                    <span className="text-ink-secondary">{t("controle.card.why")}</span>&nbsp; {huidig.kaart.klaarAls[0] ?? huidig.kaart.title}
                  </div>
                )}
              </div>

              {huidig.voorUrl && (
                <div className="flex items-center justify-between">
                  <div className="inline-flex overflow-hidden rounded-lg border border-hairline/60" role="group" aria-label={t("controle.card.beforeAfter")}>
                    {(["voor", "na"] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setWeergave(w)}
                        className={cn("px-3.5 py-1 text-[12.5px]", weergave === w ? "bg-ink text-card" : "text-ink-secondary hover:bg-control")}
                      >
                        {t(w === "voor" ? "controle.card.before" : "controle.card.after")}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11.5px] text-ink-tertiary">{t("controle.card.keysHint")}</span>
                </div>
              )}
              <Beeld wijziging={huidig} weergave={weergave} />
            </>
          )}
          {melding && <div className="text-[12px] text-ink-secondary">{melding}</div>}
        </div>

        {huidig && (
          <div className="border-t border-hairline/40 bg-panel/40 px-4 py-2.5">
            {afkeuren ? (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("controle.card.feedbackLabel")}</span>
                  <textarea
                    autoFocus
                    rows={2}
                    value={feedback}
                    onChange={(event) => {
                      setFeedback(event.target.value);
                      setFout(null);
                    }}
                    placeholder={t("controle.card.feedbackPlaceholder")}
                    className="w-full resize-none rounded-lg border border-hairline/60 bg-panel/40 px-2.5 py-1.5 text-[13px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent/60"
                  />
                </label>
                <div className="flex gap-2">
                  <button type="button" disabled={bezig} className={cn(BUTTON, "bg-accent text-white hover:opacity-90")} onClick={() => void besluit("fout")}>
                    {bezig && <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden />}
                    {t("controle.card.send")}
                  </button>
                  <button type="button" disabled={bezig} className={cn(BUTTON, "text-ink-secondary hover:bg-control hover:text-ink")} onClick={() => { setAfkeuren(false); setFout(null); }}>
                    {t("controle.card.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" disabled={bezig} className={cn(BUTTON, "bg-accent text-white hover:opacity-90")} onClick={() => void besluit("goed")}>
                  {bezig ? <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden /> : <Check size={12} className="mr-1 inline" aria-hidden />}
                  {t("controle.card.approve")}
                </button>
                <button type="button" disabled={bezig} className={cn(BUTTON, "bg-control text-ink hover:bg-control/80")} onClick={() => setAfkeuren(true)}>
                  <MessageSquare size={12} className="mr-1 inline" aria-hidden />
                  {t("controle.card.reject")}
                </button>
                {lijst && lijst.wijzigingen.length > 1 && (
                  <button type="button" disabled={bezig} className={cn(BUTTON, "ml-auto text-ink-secondary hover:bg-control hover:text-ink")} onClick={() => volgende(null, false)}>
                    {t("controle.card.skip")}
                  </button>
                )}
              </div>
            )}
            {fout && <div className="mt-1.5 text-[12px] text-danger" role="alert">{fout}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
