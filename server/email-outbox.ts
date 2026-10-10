// Outgoing Gmail through connected apps (fork). Every Gmail send or draft a
// bot makes crosses the connector relay, so this is where the rules about
// outgoing mail live — not in prompts a model may forget:
//
//   * the person's own Gmail signature (their send-as signature in Gmail,
//     the one source of truth) is appended to every body that leaves;
//   * attended work (a person is in the chat) gets an editable email card
//     instead of the send — the person sends it, drafts it or drops it;
//   * unattended work (routines, webhooks, delegated work) may only draft,
//     unless the routine it runs for says its mail may go out directly.
//
// This module is pure: the relay route and the card routes in index.ts
// fetch signatures and run the tools.
import type { EmailCardData } from "../shared/wire.ts";

/** compose: show the person a card. draft: Gmail drafts only. send: as asked. */
export type MailMode = "compose" | "draft" | "send";

export const GMAIL_SEND_EMAIL = "GMAIL_SEND_EMAIL";
export const GMAIL_CREATE_EMAIL_DRAFT = "GMAIL_CREATE_EMAIL_DRAFT";
export const GMAIL_REPLY_TO_THREAD = "GMAIL_REPLY_TO_THREAD";
export const GMAIL_SEND_DRAFT = "GMAIL_SEND_DRAFT";
export const GMAIL_FORWARD_MESSAGE = "GMAIL_FORWARD_MESSAGE";

/** Tools that write a mail body, and the argument that holds it. */
const BODY_FIELD: Record<string, string> = {
  [GMAIL_SEND_EMAIL]: "body",
  [GMAIL_CREATE_EMAIL_DRAFT]: "body",
  [GMAIL_REPLY_TO_THREAD]: "message_body",
};

/** Tools that make mail leave the mailbox without a body of their own. */
const SENDS_WITHOUT_BODY = new Set([GMAIL_SEND_DRAFT, GMAIL_FORWARD_MESSAGE]);

export function writesMailBody(tool: string): boolean {
  return Object.hasOwn(BODY_FIELD, tool);
}

export function sendsMail(tool: string): boolean {
  return tool === GMAIL_SEND_EMAIL || tool === GMAIL_REPLY_TO_THREAD || SENDS_WITHOUT_BODY.has(tool);
}

function isOutgoingMailTool(tool: string): boolean {
  return writesMailBody(tool) || SENDS_WITHOUT_BODY.has(tool);
}

type Args = Record<string, unknown>;

/** One Gmail tool inside a relayed tools/call frame. `args` and `item` are
 * the frame's own objects, so rewriting them rewrites what is relayed. */
export interface MailCall {
  tool: string;
  args: Args;
  account?: string;
  /** The COMPOSIO_MULTI_EXECUTE_TOOL entry, or null for a direct call. */
  item: Args | null;
}

export interface MailCalls {
  calls: MailCall[];
  /** Other tools in the same frame. */
  others: string[];
  /** Direct calls name their tool in params.name, which a rewrite must follow. */
  params: Args | null;
}

function record(value: unknown): Args | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Args) : null;
}

/** The outgoing Gmail calls in one relayed JSON-RPC frame, if any. */
export function mailCallsInFrame(frame: unknown): MailCalls {
  const none: MailCalls = { calls: [], others: [], params: null };
  const body = record(frame);
  if (!body || body.method !== "tools/call") return none;
  const params = record(body.params);
  if (!params || typeof params.name !== "string") return none;
  if (params.name === "COMPOSIO_MULTI_EXECUTE_TOOL") {
    const tools = record(params.arguments)?.tools;
    if (!Array.isArray(tools)) return none;
    const result: MailCalls = { calls: [], others: [], params: null };
    for (const entry of tools) {
      const item = record(entry);
      const slug = typeof item?.tool_slug === "string" ? item.tool_slug : "";
      if (!item || !isOutgoingMailTool(slug)) {
        result.others.push(slug);
        continue;
      }
      if (!record(item.arguments)) item.arguments = {};
      result.calls.push({
        tool: slug,
        args: item.arguments as Args,
        ...(typeof item.account === "string" && item.account ? { account: item.account } : {}),
        item,
      });
    }
    return result.calls.length ? result : none;
  }
  if (!isOutgoingMailTool(params.name)) return none;
  if (!record(params.arguments)) params.arguments = {};
  return {
    calls: [{ tool: params.name, args: params.arguments as Args, item: null }],
    others: [],
    params,
  };
}

/** Point one call at another tool with other arguments, in place. */
export function rewriteCall(calls: MailCalls, call: MailCall, tool: string, args: Args): void {
  for (const key of Object.keys(call.args)) delete call.args[key];
  Object.assign(call.args, args);
  call.tool = tool;
  if (call.item) call.item.tool_slug = tool;
  else if (calls.params) calls.params.name = tool;
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}

/** "Name <address>" → "address": Gmail via Composio only takes bare addresses. */
function bare(value: string): string {
  const angle = value.match(/<([^<>]+)>\s*$/);
  return (angle ? angle[1]! : value).trim();
}

function addresses(value: unknown): string[] {
  return strings(value).map(bare);
}

/** The draft an unattended send becomes: same people, words and thread. */
export function draftInstead(tool: string, args: Args): Args {
  const to = [...addresses(args.recipient_email ?? args.to), ...addresses(args.extra_recipients)];
  const body = tool === GMAIL_REPLY_TO_THREAD ? args.message_body : args.body;
  return {
    ...(to.length ? { recipient_email: to[0] } : {}),
    ...(to.length > 1 ? { extra_recipients: to.slice(1) } : {}),
    ...(strings(args.cc).length ? { cc: addresses(args.cc) } : {}),
    ...(strings(args.bcc).length ? { bcc: addresses(args.bcc) } : {}),
    ...(typeof args.subject === "string" ? { subject: args.subject } : {}),
    ...(typeof body === "string" ? { body } : {}),
    ...(args.is_html === true ? { is_html: true } : {}),
    ...(typeof args.thread_id === "string" && args.thread_id ? { thread_id: args.thread_id } : {}),
    ...(typeof args.user_id === "string" ? { user_id: args.user_id } : {}),
    ...(args.attachment !== undefined ? { attachment: args.attachment } : {}),
  };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Readable text of an HTML fragment: enough to compare and to edit. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[1-6])>/gi, "\n\n")
    .replace(/<\/(div|li|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (whole, name: string) => {
      const lower = name.toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
      return ENTITIES[lower] ?? whole;
    })
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function plainToHtml(text: string): string {
  return `<div dir="ltr">${escapeHtml(text).replace(/\r?\n/g, "<br>")}</div>`;
}

function comparable(text: string): string {
  return htmlToText(text).replace(/\s+/g, " ").toLowerCase();
}

/** True when the body already carries this signature (a bot or an older
 * prompt pasted it), so it is never added twice. */
export function hasSignature(body: string, signatureHtml: string): boolean {
  if (/class=["']?gmail_signature/i.test(body)) return true;
  const signature = comparable(signatureHtml);
  return signature.length > 0 && comparable(body).includes(signature);
}

/** The body with the signature appended, as HTML. */
export function bodyWithSignature(body: string, isHtml: boolean, signatureHtml: string): string {
  const html = isHtml ? body : plainToHtml(body);
  return `${html}<br><div dir="ltr" class="gmail_signature">${signatureHtml}</div>`;
}

/** Append the signature to one call's body, in place. False when nothing changed. */
export function signCall(call: MailCall, signatureHtml: string): boolean {
  const field = BODY_FIELD[call.tool];
  if (!field || !signatureHtml.trim()) return false;
  const body = typeof call.args[field] === "string" ? (call.args[field] as string) : "";
  if (hasSignature(body, signatureHtml)) return false;
  call.args[field] = bodyWithSignature(body, call.args.is_html === true, signatureHtml);
  call.args.is_html = true;
  return true;
}

/** What a card shows for a call the bot made: plain text the person edits. */
export function cardFromCall(call: MailCall): Omit<EmailCardData, "status" | "signature"> {
  const args = call.args;
  const to = [...strings(args.recipient_email ?? args.to), ...strings(args.extra_recipients)];
  const field = BODY_FIELD[call.tool] ?? "body";
  const raw = typeof args[field] === "string" ? (args[field] as string) : "";
  const threadId = typeof args.thread_id === "string" && args.thread_id ? args.thread_id : undefined;
  return {
    to,
    cc: strings(args.cc),
    bcc: strings(args.bcc),
    subject: typeof args.subject === "string" ? args.subject : "",
    body: args.is_html === true ? htmlToText(raw) : raw.trim(),
    ...(threadId ? { replyThreadId: threadId } : {}),
    ...(call.account ? { account: call.account } : {}),
    requested: call.tool === GMAIL_CREATE_EMAIL_DRAFT ? "draft" : "send",
  };
}

/** The Gmail tool and arguments that carry out the person's choice. */
export function callForCard(
  draft: Pick<EmailCardData, "to" | "cc" | "bcc" | "subject" | "body" | "replyThreadId">,
  action: "send" | "draft",
): { tool: string; args: Args } {
  const to = draft.to.map(bare);
  const people = {
    recipient_email: to[0],
    ...(to.length > 1 ? { extra_recipients: to.slice(1) } : {}),
    ...(draft.cc.length ? { cc: draft.cc.map(bare) } : {}),
    ...(draft.bcc.length ? { bcc: draft.bcc.map(bare) } : {}),
  };
  if (action === "send" && draft.replyThreadId) {
    return {
      tool: GMAIL_REPLY_TO_THREAD,
      args: { ...people, thread_id: draft.replyThreadId, message_body: draft.body, is_html: false, user_id: "me" },
    };
  }
  return {
    tool: action === "send" ? GMAIL_SEND_EMAIL : GMAIL_CREATE_EMAIL_DRAFT,
    args: {
      ...people,
      subject: draft.subject,
      body: draft.body,
      is_html: false,
      user_id: "me",
      ...(draft.replyThreadId ? { thread_id: draft.replyThreadId } : {}),
    },
  };
}

const ADDRESS = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/** An address as the card accepts it: bare, or "Name <address>". */
export function validAddress(value: string): boolean {
  return ADDRESS.test(bare(value));
}

/** The person's edits, checked. Returns an error line or the clean draft. */
export function cleanCardEdits(
  input: Record<string, unknown>,
  card: EmailCardData,
): { error: string } | { draft: Pick<EmailCardData, "to" | "cc" | "bcc" | "subject" | "body" | "replyThreadId"> } {
  const list = (value: unknown, fallback: string[]) =>
    value === undefined ? fallback : strings(Array.isArray(value) ? value : String(value).split(/[,;\n]/));
  const to = list(input.to, card.to);
  const cc = list(input.cc, card.cc);
  const bcc = list(input.bcc, card.bcc);
  const subject = typeof input.subject === "string" ? input.subject.trim().slice(0, 500) : card.subject;
  const body = typeof input.body === "string" ? input.body.slice(0, 100_000) : card.body;
  if (!to.length) return { error: "Add at least one recipient" };
  const bad = [...to, ...cc, ...bcc].find((address) => !validAddress(address));
  if (bad) return { error: `"${bad}" is not an email address` };
  if (!card.replyThreadId && !subject && !body.trim()) return { error: "Add a subject or a message" };
  return { draft: { to, cc, bcc, subject, body, ...(card.replyThreadId ? { replyThreadId: card.replyThreadId } : {}) } };
}

// ── what the model is told ──

export function cardShownText(count: number): string {
  return [
    `OpenMausBot showed the person ${count === 1 ? "an editable email card" : `${count} editable email cards`} instead of running this call.`,
    "They can change the recipients, subject and text, then send it, save it as a Gmail draft, or discard it. Their Gmail signature is added automatically, so never write one yourself.",
    "End this turn now. You will be told what they chose.",
  ].join(" ");
}

export const MIXED_CALL_TEXT =
  "Gmail send and draft tools must run in their own call, so OpenMausBot can show the person the email card. Nothing in this call was performed. Run the other tools first, then the Gmail call on its own.";

export function draftOnlyRefusal(tool: string): string {
  return `This work runs without a person watching, and its mail setting allows Gmail drafts only. "${tool}" was not performed. Leave the mail as a draft and say so in your report.`;
}

export const DRAFTED_INSTEAD_NOTE =
  "Note from OpenMausBot: this work runs without a person watching and its mail setting allows Gmail drafts only, so this mail was saved as a Gmail draft and NOT sent. Report it as a draft.";

export function cardOutcomeText(action: "send" | "draft" | "discard", card: EmailCardData): string {
  if (action === "discard") {
    return "OpenMausBot email card: the person discarded the email. Nothing was sent or saved. Do not send it another way; ask what they want if it is unclear.";
  }
  const people = [
    `To: ${card.to.join(", ")}`,
    card.cc.length ? `Cc: ${card.cc.join(", ")}` : "",
    card.bcc.length ? `Bcc: ${card.bcc.join(", ")}` : "",
    card.replyThreadId ? `Reply in Gmail thread ${card.replyThreadId}` : `Subject: ${card.subject}`,
  ].filter(Boolean).join("\n");
  const done = action === "send"
    ? `the person SENT the email${card.messageId ? ` (Gmail message ${card.messageId})` : ""}`
    : `the person saved the email as a Gmail DRAFT${card.draftId ? ` (draft ${card.draftId})` : ""}; it was not sent`;
  return `OpenMausBot email card: ${done}, with their signature.\n${people}\n\nFinal text:\n${card.body}\n\nContinue the task that paused for this email. Do not send or draft it again.`;
}

/** Add a line for the model to a relayed tools/call result (plain JSON or
 * an SSE stream), so a mail saved as a draft is never reported as sent. */
export function withResultNote(bytes: Uint8Array, note: string): Uint8Array {
  const text = new TextDecoder().decode(bytes);
  const annotate = (frame: unknown): unknown => {
    const result = record(record(frame)?.result);
    if (!result) return frame;
    const content = Array.isArray(result.content) ? result.content : [];
    return { ...(frame as Args), result: { ...result, content: [...content, { type: "text", text: note }] } };
  };
  try {
    if (text.trim().startsWith("{")) return new TextEncoder().encode(JSON.stringify(annotate(JSON.parse(text))));
    const lines = text.split("\n").map((line) => {
      if (!line.startsWith("data:")) return line;
      const payload = line.slice(5).trim();
      if (!payload.startsWith("{")) return line;
      return `data: ${JSON.stringify(annotate(JSON.parse(payload)))}`;
    });
    return new TextEncoder().encode(lines.join("\n"));
  } catch {
    return bytes;
  }
}

/** Gmail ids from a send or draft result, for the card and the bot. */
export function gmailIds(tool: string, data: Record<string, unknown> | undefined): { draftId?: string; messageId?: string } {
  const inner = record(data?.response_data) ?? data;
  const id = typeof inner?.id === "string" ? inner.id : undefined;
  const message = record(inner?.message);
  const messageId = typeof message?.id === "string" ? message.id : undefined;
  if (tool === GMAIL_CREATE_EMAIL_DRAFT) return { ...(id ? { draftId: id } : {}), ...(messageId ? { messageId } : {}) };
  return id ? { messageId: id } : {};
}
