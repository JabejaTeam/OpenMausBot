// Settings → About me: a signed-in person's own profile, which every bot gets
// when that person is the one asking, and which bots add to as they learn.
// Only the person themselves sees or edits it here.
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";

interface Profile {
  email: string;
  name: string;
  text: string;
  maxLines: number;
}

const inputClass =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none";
const buttonClass =
  "rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink hover:bg-inset disabled:cursor-wait disabled:opacity-50";

export function AboutMeSection() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  const load = (body: Profile) => {
    setProfile(body);
    setName(body.name);
    setText(body.text);
  };

  useEffect(() => {
    let alive = true;
    api<Profile>("/api/people/me")
      .then((body) => { if (alive) load(body); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : t("settings.aboutMe.error")); });
    return () => { alive = false; };
  }, []);

  const save = async () => {
    setStatus("saving");
    setError("");
    try {
      load(await api<Profile>("/api/people/me", { method: "PUT", body: JSON.stringify({ name, text }) }));
      setStatus("saved");
    } catch (cause) {
      setStatus("idle");
      setError(cause instanceof Error ? cause.message : t("settings.aboutMe.error"));
    }
  };

  return (
    <Card title={t("settings.aboutMe.title")} subtitle={t("settings.aboutMe.subtitle")}>
      {error && <p role="alert" className="mb-3 text-[13px] text-danger">{error}</p>}
      {profile && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
            {t("settings.aboutMe.name")}
            <input
              className={inputClass}
              value={name}
              placeholder={profile.email}
              onChange={(event) => { setName(event.target.value); setStatus("idle"); }}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink-secondary">
            {t("settings.aboutMe.profile", { lines: String(profile.maxLines) })}
            <textarea
              className={`${inputClass} min-h-[240px] font-mono text-[13px]`}
              value={text}
              placeholder={t("settings.aboutMe.placeholder")}
              onChange={(event) => { setText(event.target.value); setStatus("idle"); }}
            />
          </label>
          <div className="flex items-center gap-3">
            <button type="button" className={buttonClass} disabled={status === "saving"} onClick={() => void save()}>
              {t("settings.aboutMe.save")}
            </button>
            {status === "saved" && <span className="text-[12px] text-success">{t("settings.aboutMe.saved")}</span>}
          </div>
        </div>
      )}
    </Card>
  );
}
