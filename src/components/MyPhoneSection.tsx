// Settings → Your phone: a signed-in person pairs the OpenMausBot app on
// their own phone. The code carries their email and their own scopes, so the
// phone is them (private bots, profile, tokens), never more.
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { minutesLeft, type PairingOffer } from "./ServerPairingCard";
import { Card } from "./SettingsPrimitives";

/** The server also answers the custom-scheme link the app opens by itself,
 * for when this page is already on the phone and there is nothing to scan. */
type PhoneOffer = PairingOffer & { inviteUrl?: string | null };

const button = "rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-50";

export function MyPhoneSection() {
  const [offer, setOffer] = useState<PhoneOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!offer) return;
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [offer]);

  async function create() {
    setBusy(true);
    setError("");
    try {
      setOffer(await api<PhoneOffer>("/api/auth/pairing/mine", { method: "POST", body: "{}" }));
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.myPhone.error"));
    } finally {
      setBusy(false);
    }
  }

  const expired = offer ? offer.expiresAt <= now : false;
  return (
    <Card title={t("settings.myPhone.title")} subtitle={t("settings.myPhone.subtitle")}>
      <button type="button" onClick={() => void create()} disabled={busy} className={button}>
        {offer ? t("settings.myPhone.again") : t("settings.myPhone.create")}
      </button>
      {offer ? (
        <div className="mt-4 rounded-lg border border-hairline bg-card p-4">
          {expired ? (
            <p className="text-[13px] text-ink-secondary">{t("remote.serverPairing.expired")}</p>
          ) : (
            <div className="flex flex-wrap items-start gap-5">
              {offer.url ? (
                <div className="rounded-md bg-white p-2">
                  <QRCodeSVG value={offer.url} size={180} level="M" bgColor="#ffffff" fgColor="#111111" />
                </div>
              ) : null}
              <div className="min-w-[200px] flex-1">
                <p className="text-[13px] text-ink">{t("settings.myPhone.scan")}</p>
                {offer.inviteUrl ? (
                  <a href={offer.inviteUrl} className={`${button} mt-3 inline-block`}>{t("settings.myPhone.openApp")}</a>
                ) : null}
                <div className="mt-3 font-mono text-[18px] tracking-[0.14em] text-ink">{offer.code}</div>
                <div className="mt-1 text-[12.5px] text-ink-secondary">{t("remote.serverPairing.expires", { minutes: minutesLeft(offer.expiresAt, now) })}</div>
              </div>
            </div>
          )}
        </div>
      ) : null}
      {error && <p role="alert" className="mt-3 text-[13px] text-danger">{error}</p>}
    </Card>
  );
}
