// Settings → Your tokens: a signed-in person's own values on the MCP servers
// an admin opened for self-service. Shows only whether each value is set,
// never a value, and nothing about anyone else.
import { useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { Card } from "./SettingsPrimitives";

interface OwnMcpServer {
  name: string;
  kind: "url" | "command";
  valueNames: string[];
  mine: string[];
}

const inputClass =
  "w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[14px] text-ink placeholder:text-ink-secondary focus:border-accent focus:outline-none";
const buttonClass =
  "rounded-lg border border-hairline/40 px-3 py-1.5 text-[13px] text-ink hover:bg-inset disabled:cursor-wait disabled:opacity-50";

function ServerRow({ server, onChange }: { server: OwnMcpServer; onChange: (servers: OwnMcpServer[]) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const own = server.mine.length > 0;

  const run = async (init: RequestInit) => {
    setBusy(true);
    setError("");
    try {
      const body = await api<{ servers: OwnMcpServer[] }>(`/api/mcp/mine/${server.name}`, init);
      setValues({});
      onChange(body.servers);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.myTokens.error"));
    } finally {
      setBusy(false);
    }
  };
  const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim()));

  return (
    <div className="flex flex-col gap-2 border-t border-hairline/30 pt-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[14px] font-medium text-ink">{server.name}</div>
        <div className={own ? "text-[12px] text-success" : "text-[12px] text-ink-secondary"}>
          {own ? t("settings.myTokens.own") : t("settings.myTokens.shared")}
        </div>
      </div>
      {server.valueNames.map((name) => (
        <input
          key={name}
          type="password"
          autoComplete="off"
          aria-label={`${server.name} ${name}`}
          placeholder={own ? t("settings.myTokens.replace", { name }) : name}
          value={values[name] ?? ""}
          disabled={busy}
          onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
          className={inputClass}
        />
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={busy || !Object.keys(filled).length}
          onClick={() => void run({ method: "PUT", body: JSON.stringify({ values: filled }) })}
        >
          {t("settings.myTokens.save")}
        </button>
        {own && (
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void run({ method: "DELETE" })}>
            {t("settings.myTokens.clear")}
          </button>
        )}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function MyMcpTokensSection() {
  const [servers, setServers] = useState<OwnMcpServer[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api<{ servers: OwnMcpServer[] }>("/api/mcp/mine")
      .then((body) => { if (alive) setServers(body.servers); })
      .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : t("settings.myTokens.error")); });
    return () => { alive = false; };
  }, []);

  return (
    <Card title={t("settings.myTokens.title")} subtitle={t("settings.myTokens.subtitle")}>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">{error}</p>
      ) : servers === null ? null : servers.length === 0 ? (
        <p className="text-[13px] text-ink-secondary">{t("settings.myTokens.none")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {servers.map((server) => <ServerRow key={server.name} server={server} onChange={setServers} />)}
        </div>
      )}
    </Card>
  );
}
