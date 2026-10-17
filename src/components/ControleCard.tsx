// Fork: the controle card (server/controle-card.ts). One item at a time from
// the testlab: a roadmap card (title, "Klaar als", test plan, and the
// screenshots that changed for it, or "no visual change"), or a loose change
// (= one commit). Before and after with a thin frame round the change, paging
// through every screenshot, and approve / reject (with feedback) / skip for
// the whole item at once. Approving a card approves the card; rejecting sends
// it back to planned with the feedback. Every click goes straight to the
// testlab as the person who clicked; the bot takes no turn.
import { useCallback, useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, MessageSquare, RefreshCw, ScanEye } from "lucide-react";
import { beeldenVan, type ControleBeeld, type ControleLijst } from "../../shared/controle-card";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { api, type Message } from "@/state/store";
import { AttachmentPreviewDialog } from "./AttachmentPreview";

const BUTTON = "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors active:scale-[0.98] disabled:opacity-50";
const CHIP = "rounded-full bg-control px-2 py-0.5 text-[11px] text-ink-secondary";

function Beeld({ wijziging, weergave }: { wijziging: ControleBeeld & { titel: string }; weergave: "voor" | "na" }) {
  const [open, setOpen] = useState(false);
  const src = weergave === "voor" && wijziging.voorUrl ? wijziging.voorUrl : wijziging.naUrl;
  const kader = src === wijziging.naUrl ? wijziging.kader : null;
  // Groot bekijken in de app zelf (dezelfde viewer als bijlagen), met voor en
  // na als twee beelden: pijltjes of ← → wisselen ertussen.
  const beelden = [
    ...(wijziging.voorUrl ? [{ src: wijziging.voorUrl, name: `${t("controle.card.before")} · ${wijziging.titel}`, openUrl: wijziging.voorUrl }] : []),
    { src: wijziging.naUrl, name: `${t("controle.card.after")} · ${wijziging.titel}`, openUrl: wijziging.naUrl },
  ];
  return (
    <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={t("controle.card.enlarge")}
      className="block max-h-[420px] w-full cursor-zoom-in overflow-auto rounded-lg border border-hairline/50 bg-panel/40 text-left"
    >
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
    </button>
    {open && (
      <AttachmentPreviewDialog
        image={beelden[beelden.length - 1]}
        images={beelden}
        initialIndex={weergave === "voor" && wijziging.voorUrl ? 0 : beelden.length - 1}
        onClose={() => setOpen(false)}
      />
    )}
    </>
  );
}

/** An older controle card: the newest one below shows the same live list, so this one is a single line. */
function VervangenKaart() {
  return (
    <div className="flex w-full justify-start">
      <div className="flex items-center gap-2 rounded-xl border border-hairline/40 bg-panel/40 px-3 py-2 text-[12.5px] text-ink-secondary">
        <ScanEye size={13} aria-hidden />
        {t("controle.card.replaced")}
      </div>
    </div>
  );
}

export function ControleCard({ botId, threadId, replaced = false }: { botId: string; threadId: string; message: Message; replaced?: boolean }) {
  return replaced ? <VervangenKaart /> : <LevendeKaart botId={botId} threadId={threadId} />;
}

function LevendeKaart({ botId, threadId }: { botId: string; threadId: string }) {
  const [lijst, setLijst] = useState<ControleLijst | null>(null);
  const [laadFout, setLaadFout] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [scherm, setScherm] = useState(0);
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
  const beelden = huidig ? beeldenVan(huidig) : [];
  const beeld = beelden[Math.min(scherm, beelden.length - 1)];
  const blader = (stap: number) => setScherm((i) => (i + stap + beelden.length) % beelden.length);

  const volgende = (tekst: string | null, weg: boolean) => {
    setMelding(tekst);
    setAfkeuren(false);
    setFeedback("");
    setFout(null);
    setWeergave("na");
    setScherm(0);
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
        body: JSON.stringify({ threadId, ...(huidig.kaartId ? { kaartId: huidig.kaartId } : {}), beeldIds: huidig.beeldIds, besluit: keuze, ...(keuze === "fout" ? { feedback: feedback.trim() } : {}) }),
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
    if ((event.target as HTMLElement).tagName === "TEXTAREA" || !beeld) return;
    if (event.key === "ArrowLeft" && beeld.voorUrl) setWeergave("voor");
    if (event.key === "ArrowRight") setWeergave("na");
    if (event.key === "ArrowUp" && beelden.length > 1) blader(-1);
    if (event.key === "ArrowDown" && beelden.length > 1) blader(1);
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

          {lijst?.dekking && (
            <div className="flex flex-col gap-1 rounded-lg bg-control/60 px-3 py-2 text-[12px] leading-snug text-ink-secondary">
              <div>
                <span className="font-medium text-ink">{t("controle.card.coverage")}:</span> {lijst.dekking.samenvatting}
              </div>
              {lijst.dekking.minder.length > 0 && !lijst.dekking.aangekondigd && (
                <div className="text-danger">
                  {t("controle.card.coverageDrop", { n: String(lijst.dekking.minder.length) })}: {lijst.dekking.minder.slice(0, 3).join(" · ")}
                </div>
              )}
              {lijst.dekking.aangekondigd && <div>{t("controle.card.coverageAnnounced", { reason: lijst.dekking.aangekondigd })}</div>}
              <a href={lijst.dekking.link} target="_blank" rel="noreferrer" className="w-fit underline underline-offset-2">
                {t("controle.card.coverageDetails")}
              </a>
            </div>
          )}

          {lijst && !huidig && (
            <div className="flex items-center gap-2 text-[13.5px] text-ink">
              <span className="flex size-8 items-center justify-center rounded-lg bg-success/15 text-success">
                <Check size={16} aria-hidden />
              </span>
              {t("controle.card.allDone")}
            </div>
          )}

          {huidig && (
            <>
              <div className="flex flex-wrap items-center gap-1.5">
                {huidig.kaart && !huidig.kaartId && <span className={CHIP}>{huidig.kaart.title}</span>}
                {huidig.kaartId && <span className={CHIP}>{t("controle.card.roadmapCard")}</span>}
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
                {/* The title is already the commit's subject: "Anders" only when it says more. */}
                {huidig.anders && huidig.anders !== huidig.titel && (
                  <div>
                    <span className="text-ink-secondary">{t("controle.card.changed")}</span>&nbsp; {huidig.anders}
                  </div>
                )}
                {huidig.kaart && !huidig.kaartId && (
                  <div>
                    <span className="text-ink-secondary">{t("controle.card.why")}</span>&nbsp; {huidig.kaart.klaarAls[0] ?? huidig.kaart.title}
                  </div>
                )}
              </div>
              {huidig.kaartId && huidig.kaart && (huidig.kaart.klaarAls.length > 0 || !!huidig.kaart.testPlan?.stappen?.length) && (
                <div className="flex flex-col gap-2 rounded-lg bg-panel/40 px-3 py-2.5 text-[13px] leading-relaxed">
                  {huidig.kaart.klaarAls.length > 0 && (
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("controle.card.klaarAls")}</div>
                      <ul className="mt-0.5 list-disc pl-4 text-ink">
                        {huidig.kaart.klaarAls.map((regel, i) => <li key={i}>{regel}</li>)}
                      </ul>
                    </div>
                  )}
                  {/* The plan's "wat" repeats the title in other words: only the steps. */}
                  {!!huidig.kaart.testPlan?.stappen?.length && (
                    <div>
                      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("controle.card.testPlan")}</div>
                      <ol className="mt-0.5 list-decimal pl-4 text-ink">
                        {huidig.kaart.testPlan.stappen.map((stap, i) => <li key={i}>{stap}</li>)}
                      </ol>
                    </div>
                  )}
                </div>
              )}
              {beelden.length === 0 && (
                <div className="rounded-lg border border-dashed border-hairline/70 px-3 py-4 text-center text-[13px] text-ink-secondary">
                  {t("controle.card.noVisualChange")}
                </div>
              )}

              {beelden.length > 1 && beeld && (
                <div className="flex items-center gap-1.5 text-[12.5px]">
                  <button type="button" aria-label={t("controle.card.prevScreenshot")} className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink" onClick={() => blader(-1)}>
                    <ChevronLeft size={14} aria-hidden />
                  </button>
                  <span className="tabular-nums text-ink-secondary">{t("controle.card.screenshot", { n: String(scherm + 1), total: String(beelden.length) })}</span>
                  <button type="button" aria-label={t("controle.card.nextScreenshot")} className="rounded-md p-1 text-ink-secondary hover:bg-control hover:text-ink" onClick={() => blader(1)}>
                    <ChevronRight size={14} aria-hidden />
                  </button>
                  <span className="truncate text-ink">{beeld.plek}</span>
                  <span className="text-ink-tertiary">· {beeld.scherm}</span>
                </div>
              )}
              {beeld?.voorUrl && (
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
              {beeld && <Beeld key={beeld.naUrl} wijziging={{ ...beeld, titel: huidig.titel }} weergave={weergave} />}
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
                  {huidig.beeldIds.length > 1 ? t("controle.card.approveAll", { n: String(huidig.beeldIds.length) }) : t("controle.card.approve")}
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
