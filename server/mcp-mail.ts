// Outgoing mail through a person's own MCP servers (fork). The rule is the
// one Gmail already follows (server/email-outbox.ts): a message to someone
// outside leaves only after a person read it on the email card, in every
// approval mode, Full included, and never with an "always" answer. The one
// exception is a routine whose mail setting is "send": the person who set it
// up already said yes (optionally only to the addresses in `unattendedTo`).
//
// Which tools send is configured per server in config.json `mcpServers`:
//
//   "outlook": { "command": "...", "outbound": "ms365" }
//   "odoo":    { "command": "...", "outbound": { "preset": "odoo", "unattendedTo": ["@ripal.be"] } }
//   "crm":     { "url": "...",     "outbound": { "tools": ["send_*", "notify-customer"] } }
//
// The presets are measured against the real servers (Softeria
// ms-365-mcp-server 0.148.2's endpoints.json, deltix odoo-mcp 0.27) and
// mirror the tool list of Hermes' mail-verzendrem plugin.
//
// Where a mail sits in a tool's arguments differs per server, but the key
// names do not (to/cc/bcc/subject, Graph's toRecipients one level deeper),
// so one walker reads them all and writes the person's edits back in the
// shape it found them in: attachments, saveToSentItems and everything else
// the card does not show stay untouched.
//
// This module is pure: the gate process (mcp-mail-gate.ts) and the harness
// (index.ts) both use it.
import type { EmailCardData } from "../shared/wire.ts";
import { htmlToText, plainToHtml, validAddress, type MailMode } from "./email-outbox.ts";

type Args = Record<string, unknown>;

export const MCP_MAIL_PRESETS = ["ms365", "odoo"] as const;
export type McpMailPreset = (typeof MCP_MAIL_PRESETS)[number];

export interface McpMailSpec {
  /** Built-in tool list for a known server. */
  preset?: McpMailPreset;
  /** More tool names that send, `*` as wildcard; `_` and `-` are the same. */
  tools?: string[];
  /** In a routine allowed to send: only to these addresses or `@domains`.
   * Unset: such a routine may send to anyone, as with Gmail. */
  unattendedTo?: string[];
}

/** How the card treats one sending tool. */
export interface McpMailRule {
  /** The person may change recipients, subject and text. Off where an edit
   * cannot be written back safely (Odoo's confirmation token binds the
   * body; calendar invites; calls without mail fields). */
  editable: boolean;
  /** When the tool only sometimes sends (a dry run, an event without
   * attendees). Absent: every call sends. */
  sends?: (args: Args) => boolean;
}

/** The private environment record a mail gate reads its settings from.
 * Not OMB_-prefixed: Codex refuses those on a custom server's environment. */
export const MAIL_GATE_ENV = /^OPENMAUSBOT_MAIL_GATE_[a-f0-9]{64}$/;

const MAX_DEPTH = 10;
const RAW_LIMIT = 6_000;

const record = (value: unknown): Args | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Args) : null;

/** `toRecipients`, `to_recipients` and `To` are the same field. */
const key = (name: string) => name.replace(/[_-]/g, "").toLowerCase();
/** `send_mail` and `send-mail` are the same tool. */
const toolName = (name: string) => name.trim().toLowerCase().replace(/_/g, "-");

/** Python's truthiness, for an Odoo argument the server reads with bool(). */
function pyTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === 0 || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return true;
}

/** The first filled value under one of these keys, at any depth. */
function find(value: unknown, keys: Set<string>, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = find(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = record(value);
  if (!object) return undefined;
  for (const [name, inner] of Object.entries(object)) {
    if (keys.has(key(name)) && !empty(inner)) return inner;
  }
  for (const inner of Object.values(object)) {
    const found = find(inner, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function empty(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  const object = record(value);
  return object !== null && Object.keys(object).length === 0;
}

const MAIL: McpMailRule = { editable: true };
const AS_IS: McpMailRule = { editable: false };
/** A new event invites its attendees only when it has some. */
const INVITES: McpMailRule = { editable: false, sends: (args) => find(args, new Set(["attendees"])) !== undefined };
/** Accepting or declining tells the organiser, unless sendResponse is false. */
const RESPONDS: McpMailRule = { editable: false, sends: (args) => find(args, new Set(["sendresponse"])) !== false };

const PRESETS: Record<McpMailPreset, Record<string, McpMailRule>> = {
  ms365: {
    "send-mail": MAIL,
    "send-shared-mailbox-mail": MAIL,
    "reply-mail-message": MAIL,
    "reply-all-mail-message": MAIL,
    "reply-shared-mailbox-mail": MAIL,
    "reply-all-shared-mailbox-mail": MAIL,
    "forward-mail-message": MAIL,
    "forward-shared-mailbox-mail": MAIL,
    // a draft id says nothing about who gets it
    "send-draft-message": AS_IS,
    "send-shared-mailbox-draft": AS_IS,
    "forward-calendar-event": AS_IS,
    "cancel-calendar-event": AS_IS,
    "create-calendar-event": INVITES,
    "create-specific-calendar-event": INVITES,
    // Changing or deleting an existing meeting notifies the attendees it
    // already has, which the arguments do not show, and Graph has no switch
    // to keep it quiet: always held (when unsure, hold).
    "update-calendar-event": AS_IS,
    "update-specific-calendar-event": AS_IS,
    "delete-calendar-event": AS_IS,
    "delete-specific-calendar-event": AS_IS,
    "accept-calendar-event": RESPONDS,
    "decline-calendar-event": RESPONDS,
    "tentatively-accept-calendar-event": RESPONDS,
    // one request can carry any Graph call, a sendMail among them
    "graph-batch": AS_IS,
    // Teams: a message to people as well (hidden unless the server has Chat scopes)
    "send-chat-message": AS_IS,
    "reply-to-chat-message": AS_IS,
    "send-channel-message": AS_IS,
    "reply-to-channel-message": AS_IS,
    "reply-to-group-thread": AS_IS,
  },
  odoo: {
    // dry_run (the default) only previews; a commit mails partner_ids and
    // followers. The confirmation token binds the body, so no edits.
    "odoo-send-message": { editable: false, sends: (args) => args.dry_run !== undefined && args.dry_run !== null && !pyTruthy(args.dry_run) },
  },
};

// ── the config value ──

/** Validate a server's `outbound` value. A string is a preset name. */
export function parseMcpMailSpec(raw: unknown): { ok: true; spec: McpMailSpec } | { ok: false; error: string } {
  const presetError = `outbound: use ${MCP_MAIL_PRESETS.map((name) => `"${name}"`).join(" or ")}, or { "preset", "tools", "unattendedTo" }.`;
  if (typeof raw === "string") {
    return (MCP_MAIL_PRESETS as readonly string[]).includes(raw) ? { ok: true, spec: { preset: raw as McpMailPreset } } : { ok: false, error: presetError };
  }
  const object = record(raw);
  if (!object) return { ok: false, error: presetError };
  const unknown = Object.keys(object).find((name) => !["preset", "tools", "unattendedTo"].includes(name));
  if (unknown) return { ok: false, error: `outbound: unknown field "${unknown}".` };
  const spec: McpMailSpec = {};
  if (object.preset !== undefined) {
    if (typeof object.preset !== "string" || !(MCP_MAIL_PRESETS as readonly string[]).includes(object.preset)) return { ok: false, error: presetError };
    spec.preset = object.preset as McpMailPreset;
  }
  const list = (name: "tools" | "unattendedTo", check: (item: string) => boolean): string[] | string | undefined => {
    const value = object[name];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length > 100 || !value.every((item) => typeof item === "string" && item.trim() && item.length <= 200 && check(item.trim()))) {
      return `outbound.${name}: use a list of ${name === "tools" ? "tool names" : "addresses or @domains"}.`;
    }
    return value.map((item: string) => item.trim());
  };
  const tools = list("tools", (item) => /^[\w*.-]+$/.test(item));
  if (typeof tools === "string") return { ok: false, error: tools };
  const unattendedTo = list("unattendedTo", (item) => validAddress(item) || /^@?[^\s@]+\.[^\s@]+$/.test(item));
  if (typeof unattendedTo === "string") return { ok: false, error: unattendedTo };
  if (tools?.length) spec.tools = tools;
  if (unattendedTo) spec.unattendedTo = unattendedTo.map((item) => item.toLowerCase());
  if (!spec.preset && !spec.tools) return { ok: false, error: "outbound: name a preset or at least one tool." };
  return { ok: true, spec };
}

/** The outbound setting of every configured server that has a valid one. */
export function mcpMailSpecs(servers: Record<string, unknown> | undefined): Record<string, McpMailSpec> {
  const out: Record<string, McpMailSpec> = {};
  for (const [name, server] of Object.entries(servers ?? {})) {
    const raw = record(server)?.outbound;
    if (raw === undefined) continue;
    const parsed = parseMcpMailSpec(raw);
    if (parsed.ok) out[name] = parsed.spec;
  }
  return out;
}

function glob(pattern: string, name: string): boolean {
  const source = toolName(pattern).split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${source}$`).test(name);
}

/** The rule for this call when it sends a message, else undefined. A rule
 * whose condition throws counts as sending: a missed send is the costly side. */
export function outgoingRule(spec: McpMailSpec, tool: string, args: unknown): McpMailRule | undefined {
  const name = toolName(tool);
  const rule = (spec.preset ? PRESETS[spec.preset][name] : undefined)
    ?? (spec.tools?.some((pattern) => glob(pattern, name)) ? AS_IS : undefined);
  if (!rule?.sends) return rule;
  try {
    return rule.sends(record(args) ?? {}) ? rule : undefined;
  } catch {
    return rule;
  }
}

// ── reading a mail out of the arguments ──

const RECIPIENT_KIND: Record<string, "to" | "cc" | "bcc"> = {
  to: "to",
  torecipients: "to",
  recipients: "to",
  emailto: "to",
  attendees: "to",
  partnerids: "to",
  cc: "cc",
  ccrecipients: "cc",
  bcc: "bcc",
  bccrecipients: "bcc",
};
const SUBJECT_KEYS = new Set(["subject"]);
/** `body` is not here: in Graph it is both the envelope and the text object,
 * so it is told apart by its shape. */
const TEXT_KEYS = new Set(["content", "comment"]);

export interface McpMail {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  /** Plain text, for the card. */
  text: string;
  /** A recipient field that is not an address (an Odoo partner id, a name):
   * who gets this is not known, so it never leaves unattended or edited. */
  uncertain: boolean;
}

function addressesIn(value: unknown, labels: string[], depth = 0): boolean {
  if (depth > MAX_DEPTH) return true;
  if (empty(value)) return false;
  if (typeof value === "string") {
    let uncertain = false;
    for (const part of value.replace(/;/g, ",").split(",")) {
      const bare = part.trim().replace(/^.*<([^<>]+)>\s*$/, "$1").trim();
      if (!bare) continue;
      if (bare.includes("@") && !/\s/.test(bare)) labels.push(bare.toLowerCase());
      else {
        labels.push(bare);
        uncertain = true;
      }
    }
    return uncertain;
  }
  if (typeof value === "number") {
    labels.push(`#${value}`);
    return true;
  }
  if (Array.isArray(value)) {
    let uncertain = false;
    for (const item of value) uncertain = addressesIn(item, labels, depth + 1) || uncertain;
    return uncertain;
  }
  const object = record(value);
  if (!object) return true;
  const inner = record(object.emailAddress ?? object.emailaddress);
  if (inner) return addressesIn(inner.address ?? inner.Address, labels, depth + 1);
  for (const field of ["address", "Address", "email"]) {
    if (field in object) return addressesIn(object[field], labels, depth + 1);
  }
  return true;
}

/** A `body` that is the text ({ contentType, content }), not the envelope. */
const textObject = (value: unknown) => {
  const object = record(value);
  return object !== null && Object.keys(object).some((name) => key(name) === "content");
};

const isHtml = (object: Args) => Object.entries(object).some(([name, value]) => key(name) === "contenttype" && String(value).toLowerCase() === "html");

/** The mail in a call's arguments, whatever their depth or shape. */
export function readMail(args: unknown): McpMail {
  const mail: McpMail = { to: [], cc: [], bcc: [], subject: "", text: "", uncertain: false };
  let text: { value: string; html: boolean } | undefined;
  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) {
      mail.uncertain = true;
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const object = record(value);
    if (!object) return;
    for (const [name, inner] of Object.entries(object)) {
      const normalized = key(name);
      const kind = RECIPIENT_KIND[normalized];
      if (kind) {
        if (addressesIn(inner, mail[kind])) mail.uncertain = true;
        continue;
      }
      if (normalized === "body" && typeof inner === "string") {
        if (inner && !text) text = { value: inner, html: /<[a-z][\s\S]*>/i.test(inner) };
        continue;
      }
      if (normalized === "body" && textObject(inner)) {
        const body = inner as Args;
        const content = Object.entries(body).find(([field]) => key(field) === "content")?.[1];
        if (typeof content === "string" && content && !text) text = { value: content, html: isHtml(body) };
        continue;
      }
      walk(inner, depth + 1);
    }
  };
  walk(record(args) ?? {}, 0);
  for (const kind of ["to", "cc", "bcc"] as const) mail[kind] = [...new Set(mail[kind])];
  const subject = find(args, SUBJECT_KEYS);
  mail.subject = typeof subject === "string" ? subject : "";
  if (!text) {
    const found = find(args, TEXT_KEYS);
    if (typeof found === "string") text = { value: found, html: /<[a-z][\s\S]*>/i.test(found) };
  }
  mail.text = text ? (text.html ? htmlToText(text.value) : text.value.trim()) : "";
  return mail;
}

/** Everyone who gets this mail, in any field. */
export function recipients(mail: McpMail): string[] {
  return [...new Set([...mail.to, ...mail.cc, ...mail.bcc])];
}

// ── the decision ──

function allowed(address: string, list: string[]): boolean {
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return list.some((entry) => entry.includes("@") && !entry.startsWith("@") ? entry === address : entry.replace(/^@/, "") === domain);
}

/** May this call leave without a card? Only in a routine allowed to send,
 * and, with an `unattendedTo` list, only to known addresses on it. The
 * approval mode is deliberately not an input: Full changes nothing here. */
export function mayLeaveUnattended(mode: MailMode | undefined, spec: McpMailSpec, mail: McpMail): boolean {
  if (mode !== "send") return false;
  if (!spec.unattendedTo) return true;
  const people = recipients(mail);
  return !mail.uncertain && people.length > 0 && people.every((address) => allowed(address, spec.unattendedTo!));
}

// ── the card ──

/** What the person can do with an MCP mail card: never "always". */
export const MCP_CARD_ACTIONS = ["send", "discard"] as const;

export function mailCard(input: { server: string; tool: string; args: unknown; rule: McpMailRule; requestId: string }): EmailCardData {
  const mail = readMail(input.args);
  let raw = JSON.stringify(input.args ?? {}, null, 2);
  if (raw.length > RAW_LIMIT) raw = `${raw.slice(0, RAW_LIMIT)}\n…`;
  return {
    to: mail.to,
    cc: mail.cc,
    bcc: mail.bcc,
    subject: mail.subject,
    body: mail.text,
    requested: "send",
    status: "editable",
    mcp: {
      server: input.server,
      tool: input.tool,
      requestId: input.requestId,
      editable: input.rule.editable && !mail.uncertain,
      raw,
    },
  };
}

type Draft = Pick<EmailCardData, "to" | "cc" | "bcc" | "subject" | "body">;

/** The person's edits to an MCP card, checked. A reply may have no
 * recipients of its own (the mail app answers the sender); a card that
 * had some must keep at least one. */
export function cleanMcpEdits(input: Record<string, unknown>, card: EmailCardData): { error: string } | { draft: Draft } {
  if (!card.mcp?.editable) return { draft: { to: card.to, cc: card.cc, bcc: card.bcc, subject: card.subject, body: card.body } };
  const list = (value: unknown, fallback: string[]) => value === undefined
    ? fallback
    : (Array.isArray(value) ? value : String(value).split(/[,;\n]/)).filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  const to = list(input.to, card.to);
  const cc = list(input.cc, card.cc);
  const bcc = list(input.bcc, card.bcc);
  const subject = typeof input.subject === "string" ? input.subject.trim().slice(0, 500) : card.subject;
  const body = typeof input.body === "string" ? input.body.slice(0, 100_000) : card.body;
  if (card.to.length && !to.length) return { error: "Add at least one recipient" };
  const bad = [...to, ...cc, ...bcc].find((address) => !validAddress(address));
  if (bad) return { error: `"${bad}" is not an email address` };
  return { draft: { to, cc, bcc, subject, body } };
}

const sameList = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item.toLowerCase() === right[index]!.toLowerCase());

/** Addresses in the shape the old field had. */
function shaped(old: unknown, addresses: string[]): unknown {
  if (typeof old === "string") return addresses.join(", ");
  if (Array.isArray(old)) {
    const example = old.find((item) => record(item));
    if (example && ("emailAddress" in example || "emailaddress" in example)) return addresses.map((address) => ({ emailAddress: { address } }));
    if (example) return addresses.map((address) => ({ address }));
  }
  return [...addresses];
}

/** The call's arguments with the person's edits, in the shape they came in.
 * Only fields the person changed are written; nothing is removed. */
export function argsWithEdits(args: unknown, before: Draft, after: Draft): Args {
  const next = structuredClone(record(args) ?? {}) as Args;
  const changed = {
    to: !sameList(before.to, after.to),
    cc: !sameList(before.cc, after.cc),
    bcc: !sameList(before.bcc, after.bcc),
    subject: before.subject !== after.subject,
    body: before.body !== after.body,
  };
  if (!Object.values(changed).some(Boolean)) return next;
  const wanted = { to: after.to, cc: after.cc, bcc: after.bcc };
  const written = { to: false, cc: false, bcc: false };
  let toHolder: { object: Args; name: string; old: unknown } | undefined;
  let subjectDone = false;
  let bodyDone = false;
  const html = (text: string) => plainToHtml(text);
  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, depth + 1);
      return;
    }
    const object = record(value);
    if (!object) return;
    for (const name of Object.keys(object)) {
      const inner = object[name];
      const normalized = key(name);
      const kind = RECIPIENT_KIND[normalized];
      if (kind) {
        if (kind === "to" && !toHolder) toHolder = { object, name, old: inner };
        if (changed[kind]) object[name] = shaped(inner, wanted[kind]);
        written[kind] = true;
        continue;
      }
      if (SUBJECT_KEYS.has(normalized)) {
        if (!subjectDone && typeof inner === "string") {
          if (changed.subject) object[name] = after.subject;
          subjectDone = true;
        }
        continue;
      }
      if (normalized === "body" && typeof inner === "string") {
        if (!bodyDone) {
          if (changed.body) object[name] = /<[a-z][\s\S]*>/i.test(inner) ? html(after.body) : after.body;
          bodyDone = true;
        }
        continue;
      }
      if (normalized === "body" && textObject(inner)) {
        if (!bodyDone) {
          const body = inner as Args;
          const field = Object.keys(body).find((candidate) => key(candidate) === "content")!;
          if (changed.body) body[field] = isHtml(body) ? html(after.body) : after.body;
          bodyDone = true;
        }
        continue;
      }
      if (TEXT_KEYS.has(normalized) && typeof inner === "string") {
        if (!bodyDone) {
          if (changed.body) object[name] = /<[a-z][\s\S]*>/i.test(inner) ? html(after.body) : after.body;
          bodyDone = true;
        }
        continue;
      }
      walk(inner, depth + 1);
    }
  };
  walk(next, 0);
  // A cc or bcc the person added where the call had none: next to `to`,
  // named the way `to` is (toRecipients → ccRecipients).
  if (toHolder) {
    for (const kind of ["cc", "bcc"] as const) {
      if (written[kind] || !wanted[kind].length) continue;
      const name = key(toHolder.name) === "torecipients" ? `${kind}Recipients` : kind;
      toHolder.object[name] = shaped(toHolder.old, wanted[kind]);
    }
  }
  return next;
}

// ── what the model is told ──

export function sentNote(card: EmailCardData, edited: boolean): string {
  const people = [
    card.to.length ? `To: ${card.to.join(", ")}` : "",
    card.cc.length ? `Cc: ${card.cc.join(", ")}` : "",
    card.bcc.length ? `Bcc: ${card.bcc.join(", ")}` : "",
    card.subject ? `Subject: ${card.subject}` : "",
  ].filter(Boolean).join("\n");
  return [
    `Note from OpenMausBot: the person reviewed this on the email card and chose Send${edited ? ", with their own changes" : ""}. The result above is what the mail app answered.`,
    edited ? `${people}\n\nFinal text:\n${card.body}` : "",
    "Do not send it again.",
  ].filter(Boolean).join("\n");
}

export const DISCARDED_TEXT =
  "OpenMausBot email card: the person discarded this message. Nothing was sent. Do not send it another way; ask what they want if it is unclear.";
export const TIMEOUT_TEXT =
  "OpenMausBot did not send this: nobody answered the email card in time. Ask the person before trying again.";
export const UNREACHABLE_TEXT =
  "OpenMausBot did not send this: the email card could not be shown, so the message stays unsent. Tell the person.";
