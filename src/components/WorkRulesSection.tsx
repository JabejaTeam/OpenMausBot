// Settings → Work rules: the workspace's rules by kind of bot, one text for
// every bot and one per kind of bot (server/kind-instructions.ts).
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";

type Scope = "everyone" | "code" | "pm" | "test";
const SCOPES: Array<{ scope: Scope; label: `settings.workRules.${Scope}`; hint: `settings.workRules.${Scope}Hint` }> = [
  { scope: "everyone", label: "settings.workRules.everyone", hint: "settings.workRules.everyoneHint" },
  { scope: "code", label: "settings.workRules.code", hint: "settings.workRules.codeHint" },
  { scope: "pm", label: "settings.workRules.pm", hint: "settings.workRules.pmHint" },
  { scope: "test", label: "settings.workRules.test", hint: "settings.workRules.testHint" },
];

function RulesEditor({ scope, label, hint, initial }: { scope: Scope; label: string; hint: string; initial: string }) {
  const [text, setText] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  useEffect(() => setText(initial), [initial]);

  const save = async () => {
    setStatus("saving");
    setError("");
    try {
      await api(`/api/kind-instructions/${scope}`, { method: "PUT", body: JSON.stringify({ text }) });
      setStatus("saved");
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : t("settings.workRules.error"));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="text-[14px] font-medium text-ink">{label}</div>
      <div className="text-[12px] text-ink-secondary">{hint}</div>
      <textarea
        aria-label={label}
        value={text}
        rows={10}
        onChange={(event) => { setText(event.target.value); setStatus("idle"); }}
        className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 font-mono text-[12.5px] leading-relaxed text-ink focus:border-accent focus:outline-none"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={status === "saving" || text === initial && status !== "error"}
          onClick={() => void save()}
          className="rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink hover:bg-inset disabled:opacity-50"
        >
          {t("settings.workRules.save")}
        </button>
        {status === "saved" && <span className="text-[12px] text-success">{t("settings.workRules.saved")}</span>}
        {status === "error" && <span role="alert" className="text-[12px] text-danger">{error}</span>}
      </div>
    </div>
  );
}

export function WorkRulesSection() {
  const [scopes, setScopes] = useState<Partial<Record<Scope, { text: string }>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api<{ scopes: Partial<Record<Scope, { text: string }>> }>("/api/kind-instructions")
      .then((body) => setScopes(body.scopes))
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("settings.workRules.error")));
  }, []);

  return (
    <Card title={t("settings.workRules.title")} subtitle={t("settings.workRules.subtitle")}>
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : scopes === null ? null : (
        <div className="flex flex-col gap-6">
          {SCOPES.map(({ scope, label, hint }) => (
            <RulesEditor key={scope} scope={scope} label={t(label)} hint={t(hint)} initial={scopes[scope]?.text ?? ""} />
          ))}
        </div>
      )}
    </Card>
  );
}
