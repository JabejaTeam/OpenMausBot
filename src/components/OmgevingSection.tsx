// Jabeja fork: Settings → Account → Environment. Shown only to someone on the
// sign-in list of two or more environments behind the shared front door
// (lib/voordeur-omgevingen.ts). One this window already shows (lib/omgevingen.ts)
// opens at once; any other reloads into it.
import { useState } from "react";
import { Check } from "lucide-react";
import { t } from "@/lib/i18n";
import { openOmgevingen, setActieveOmgeving, useActieveOmgeving } from "@/lib/omgevingen";
import { wisselOmgeving, type Omgeving } from "@/lib/voordeur-omgevingen";
import { Card } from "./SettingsPrimitives";

export function OmgevingSection({ omgevingen, go = (to) => window.location.assign(to) }: { omgevingen: Omgeving[]; go?: (to: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = useActieveOmgeving();
  const current = (o: Omgeving) => (shown ? o.naam === shown : o.actief);

  const choose = async (naam: string) => {
    if (openOmgevingen().some((o) => o.naam === naam)) return setActieveOmgeving(naam);
    setBusy(naam);
    setFailed(false);
    try {
      go(await wisselOmgeving(naam));
    } catch {
      setFailed(true);
      setBusy(null);
    }
  };

  return (
    <Card title={t("settings.omgeving.title")} subtitle={t("settings.omgeving.subtitle")}>
      <ul className="flex flex-col gap-2">
        {omgevingen.map((o) => (
          <li key={o.naam} data-omgeving={o.naam} className="flex min-h-12 items-center gap-3 rounded-lg bg-inset px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium text-ink">{o.titel}</div>
              <div className="text-[12.5px] text-ink-secondary">
                {current(o) ? t("settings.omgeving.current") : o.ingelogd ? t("settings.omgeving.signedIn") : t("settings.omgeving.notSignedIn")}
              </div>
            </div>
            {current(o) ? (
              <Check size={18} aria-label={t("settings.omgeving.current")} className="shrink-0 text-accent" />
            ) : (
              <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void choose(o.naam)}>
                {busy === o.naam ? t("settings.omgeving.switching") : o.ingelogd ? t("settings.omgeving.switch") : t("settings.omgeving.signIn")}
              </button>
            )}
          </li>
        ))}
      </ul>
      {failed && <p role="alert" className="mt-3 text-[13px] text-danger">{t("settings.omgeving.error")}</p>}
    </Card>
  );
}
