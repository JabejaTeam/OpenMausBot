// Fork: an outgoing email the bot wrote while you were in the chat. You edit
// it here, then send it, keep it as a Gmail draft, or discard it; the server
// sends it with your connected Gmail and appends your Gmail signature.
import { useState } from "react";
import { Check, FileText, Loader2, Mail, Send, Trash2 } from "lucide-react";

import { api, type Message } from "@/state/store";
import { t } from "@/lib/i18n";

const joinList = (list: string[]) => list.join(", ");
const splitList = (value: string) => value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{label}</span>
      {children}
      {error && <span className="text-[11.5px] text-danger">{error}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-lg border border-hairline/60 bg-panel/40 px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:border-accent/60 disabled:opacity-60";

export function EmailCard({ botId, threadId, message }: { botId: string; threadId: string; message: Message }) {
  const card = message.email!;
  const [to, setTo] = useState(joinList(card.to));
  const [cc, setCc] = useState(joinList(card.cc));
  const [bcc, setBcc] = useState(joinList(card.bcc));
  const [showBcc, setShowBcc] = useState(card.bcc.length > 0);
  const [subject, setSubject] = useState(card.subject);
  const [body, setBody] = useState(card.body);
  const [pending, setPending] = useState<"send" | "draft" | "discard" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const editable = card.status === "editable" || card.status === "failed";
  const busy = pending !== null || card.status === "working";
  const isReply = Boolean(card.replyThreadId);

  const act = async (action: "send" | "draft" | "discard") => {
    setPending(action);
    setError(null);
    try {
      await api(`/api/bots/${encodeURIComponent(botId)}/email-cards/${encodeURIComponent(message.id)}/${action}`, {
        method: "POST",
        body: JSON.stringify({ threadId, to: splitList(to), cc: splitList(cc), bcc: splitList(bcc), subject, body }),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(null);
    }
  };

  if (!editable && card.status !== "working") {
    const done = card.status === "sent"
      ? t("email.card.sent", { to: joinList(card.to) })
      : card.status === "drafted"
        ? t("email.card.drafted", { to: joinList(card.to) })
        : t("email.card.discarded");
    return (
      <div className="flex w-full justify-start">
        <div className="flex w-full max-w-[560px] items-center gap-3 rounded-2xl border border-hairline/50 bg-card px-4 py-3">
          <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${card.status === "discarded" ? "bg-control text-ink-secondary" : "bg-success/15 text-success"}`}>
            {card.status === "discarded" ? <Trash2 size={15} /> : <Check size={15} />}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium text-ink">{done}</div>
            {card.status !== "discarded" && (
              <div className="truncate text-[12px] text-ink-secondary">{isReply ? t("email.card.reply") : card.subject || t("email.card.noSubject")}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const shownError = error ?? (card.status === "failed" ? card.error : undefined);
  const primary = card.requested;

  return (
    <div className="flex w-full justify-start">
      <div className="w-full max-w-[560px] overflow-hidden rounded-2xl border border-hairline/50 bg-card shadow-sm">
        <div className="flex items-center gap-2.5 border-b border-hairline/40 px-4 py-3">
          <Mail size={15} className="text-ink-secondary" />
          <span className="text-[13.5px] font-semibold text-ink">{isReply ? t("email.card.reply") : t("email.card.title")}</span>
          {card.account && <span className="rounded-full bg-control px-2 py-0.5 text-[11px] text-ink-secondary">{card.account}</span>}
        </div>
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <Field label={t("email.card.to")}>
            <input className={inputClass} value={to} onChange={(event) => setTo(event.target.value)} disabled={busy} />
          </Field>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={t("email.card.cc")}>
              <input className={inputClass} value={cc} onChange={(event) => setCc(event.target.value)} disabled={busy} />
            </Field>
            {showBcc ? (
              <Field label={t("email.card.bcc")}>
                <input className={inputClass} value={bcc} onChange={(event) => setBcc(event.target.value)} disabled={busy} />
              </Field>
            ) : (
              <button
                type="button"
                onClick={() => setShowBcc(true)}
                disabled={busy}
                className="self-end rounded-lg px-2 py-1.5 text-left text-[12px] text-ink-secondary hover:bg-control hover:text-ink"
              >
                + {t("email.card.bcc")}
              </button>
            )}
          </div>
          {!isReply && (
            <Field label={t("email.card.subject")}>
              <input className={inputClass} value={subject} onChange={(event) => setSubject(event.target.value)} disabled={busy} />
            </Field>
          )}
          <Field label={t("email.card.message")}>
            <textarea
              className={`${inputClass} min-h-[160px] resize-y leading-relaxed`}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={busy}
            />
          </Field>
          {card.signature ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t("email.card.signature")}</span>
              {/* Gmail's own HTML, shown sandboxed: no scripts, no navigation. */}
              <iframe
                title={t("email.card.signature")}
                sandbox=""
                srcDoc={`<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px -apple-system,Segoe UI,sans-serif;color:#3f3f46;background:#fff">${card.signature}</body>`}
                className="h-[120px] w-full rounded-lg border border-hairline/40 bg-white"
              />
            </div>
          ) : (
            <p className="text-[11.5px] text-ink-tertiary">{t("email.card.noSignature")}</p>
          )}
          {shownError && <p className="text-[12px] text-danger">{shownError}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline/40 bg-panel/40 px-4 py-2.5">
          <button
            type="button"
            onClick={() => void act("discard")}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-ink-secondary transition-transform hover:bg-control hover:text-ink active:scale-[0.98] disabled:opacity-50"
          >
            {pending === "discard" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} {t("email.card.discard")}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void act("draft")}
              disabled={busy}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-transform active:scale-[0.98] disabled:opacity-50 ${primary === "draft" ? "bg-accent text-white hover:opacity-90" : "bg-control text-ink hover:bg-control/80"}`}
            >
              {pending === "draft" ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} {t("email.card.saveDraft")}
            </button>
            <button
              type="button"
              onClick={() => void act("send")}
              disabled={busy}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-transform active:scale-[0.98] disabled:opacity-50 ${primary === "send" ? "bg-accent text-white hover:opacity-90" : "bg-control text-ink hover:bg-control/80"}`}
            >
              {pending === "send" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t("email.card.send")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
