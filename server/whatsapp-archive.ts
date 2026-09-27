import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sonioxTranscribe } from "./soniox.ts";

/** A WhatsApp number's archive, fed by WasenderAPI webhooks. Every message,
 * in and out, is appended to disk without a model turn; bots read it later
 * through the WhatsApp MCP (whatsapp-mcp.ts), only when someone asks.
 *
 *     <dir>/<chat>/<yyyy-mm-dd>.jsonl     one line per message, Brussels day
 *     <dir>/<chat>/media/<id>.<ext>       the decrypted attachment
 *     <dir>/<chat>/media/<id>.<ext>.txt   what a voice note said
 *
 * <chat> is the other party's phone number for a direct chat, or
 * group-<id> for a group. Lines are append-only: a message is written the
 * moment it arrives, and written again once its attachment is on disk. The
 * reader keeps the last line per message id. */

export const WHATSAPP_MESSAGE_EVENTS = new Set([
  "messages.received",
  "messages-personal.received",
  "messages-group.received",
  "messages-newsletter.received",
  "messages.upsert",
]);

const MEDIA_KINDS: Record<string, { type: string; ext: string }> = {
  imageMessage: { type: "image", ext: "jpg" },
  videoMessage: { type: "video", ext: "mp4" },
  audioMessage: { type: "audio", ext: "ogg" },
  documentMessage: { type: "document", ext: "bin" },
  stickerMessage: { type: "sticker", ext: "webp" },
  documentWithCaptionMessage: { type: "document", ext: "bin" },
};

/** Base64 blobs that bloat `raw` without telling a reader anything. */
const FAT_KEYS = new Set(["jpegThumbnail", "thumbnailDirectPath", "streamingSidecar", "fileEncSha256", "fileSha256", "mediaKey"]);

const WASENDER_API = "https://wasenderapi.com/api";
const MAX_MEDIA_BYTES = 64 * 1024 * 1024;
const SEEN_WINDOW_MS = 15 * 60_000;
const SAFE = /[^0-9a-z:_-]/g;

export interface WhatsAppMedia {
  type: string;
  mime: string | null;
  name: string | null;
  seconds: number | null;
  caption: string | null;
  ptt: boolean | null;
  gif: boolean | null;
  file: string | null;
  bytes?: number;
  /** Still being fetched; a later line for the same id completes it. */
  pending?: boolean;
  error: string | null;
}

export interface WhatsAppRecord {
  ts: string;
  id: string;
  dir: "in" | "out";
  chat_type: "direct" | "group";
  group_id: string | null;
  peer: string | null;
  sender: string | null;
  sender_name: string | null;
  text: string | null;
  media: WhatsAppMedia | null;
  remote_jid: string | null;
  raw?: unknown;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : {});
const str = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));

/** `+32 497 40 39 49` and `32497403949@s.whatsapp.net` both become
 * `32497403949`; a group id becomes `group:<id>`. */
export function normalizeJid(value: unknown): string {
  const text = str(value).trim().toLowerCase();
  if (!text) return "";
  const [local = "", domain = ""] = text.split("@", 2);
  const clean = local.replace(SAFE, "");
  if (domain.startsWith("g.us") || clean.includes("-")) return `group:${clean}`;
  return clean;
}

/** The other party's NUMBER, whoever sent this message. With LID addressing
 * `remoteJid` is a LID (`5012…@lid`) in both directions and the number sits in
 * `cleanedSenderPn` — for outgoing messages too. One derivation for both
 * directions, or a chat splits into two folders. */
function peerOf(key: Obj, remote: string): string {
  const pn = normalizeJid(key.cleanedRemoteJid) || normalizeJid(key.cleanedSenderPn);
  if (pn) return pn;
  return normalizeJid(remote);
}

function brusselsDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function stripFat(value: unknown, depth = 0): unknown {
  if (depth > 8) return "…";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => stripFat(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !FAT_KEYS.has(key)).map(([key, item]) => [key, stripFat(item, depth + 1)]));
  }
  if (typeof value === "string" && value.length > 4_000) return `${value.slice(0, 4_000)}…`;
  return value;
}

export function extractRecord(payload: unknown, now: Date): { record: WhatsAppRecord; message: Obj } {
  let data: unknown = obj(obj(payload).data).messages;
  if (Array.isArray(data)) data = data[0];
  const messages = obj(data);
  const key = obj(messages.key);
  const remote = str(key.remoteJid);
  const isGroup = remote.endsWith("@g.us");
  const fromMe = key.fromMe === true;
  const senderPn = normalizeJid(key.cleanedParticipantPn || key.cleanedSenderPn);
  const peer = isGroup ? null : peerOf(key, remote);
  return {
    record: {
      ts: now.toISOString(),
      id: str(key.id),
      dir: fromMe ? "out" : "in",
      chat_type: isGroup ? "group" : "direct",
      group_id: isGroup ? remote.split("@")[0] ?? null : null,
      peer,
      sender: fromMe ? "self" : senderPn || peer || null,
      sender_name: str(messages.pushName || key.pushName) || null,
      text: str(messages.messageBody) || null,
      media: null,
      remote_jid: remote || null,
    },
    message: obj(messages.message),
  };
}

export function chatKey(record: Pick<WhatsAppRecord, "chat_type" | "group_id" | "peer" | "sender">): string {
  if (record.chat_type === "group") return `group-${(record.group_id ?? "").toLowerCase().replace(SAFE, "") || "unknown"}`;
  return (record.peer || record.sender || "").toLowerCase().replace(SAFE, "") || "unknown";
}

export function transcriptPath(mediaFile: string): string {
  return `${mediaFile}.txt`;
}

function mediaOf(kind: string, media: Obj): WhatsAppMedia {
  return {
    type: MEDIA_KINDS[kind]!.type,
    mime: str(media.mimetype) || null,
    name: str(media.fileName) || null,
    seconds: typeof media.seconds === "number" ? media.seconds : null,
    caption: str(media.caption) || null,
    ptt: kind === "audioMessage" ? media.ptt === true : null,
    gif: kind === "videoMessage" ? media.gifPlayback === true : null,
    file: null,
    error: null,
  };
}

function extensionFor(kind: string, media: WhatsAppMedia): string {
  if (media.name?.includes(".")) return media.name.split(".").pop()!.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || MEDIA_KINDS[kind]!.ext;
  const sub = media.mime?.split("/")[1]?.split(";")[0] ?? "";
  const mapped = ({ jpeg: "jpg", mpeg: "mp3", quicktime: "mov" } as Record<string, string>)[sub] ?? sub;
  return mapped.replace(/[^a-z0-9]/g, "").slice(0, 8) || MEDIA_KINDS[kind]!.ext;
}

export interface WhatsAppArchiveOptions {
  dir: string;
  /** The WasenderAPI session key; without it attachments cannot be decrypted. */
  sessionKey?: string;
  /** Transcribe voice notes as they arrive. */
  sonioxKey?: string;
  retentionDays?: number;
  fetch?: typeof fetch;
  now?: () => number;
  log?: (line: string) => void;
}

export interface WhatsAppAcceptResult {
  outcome: "stored" | "ignored" | "duplicate";
  reason?: string;
  event: string;
  /** Settles once the attachment (and its transcript) are on disk. */
  done: Promise<void>;
}

export class WhatsAppArchive {
  private readonly options: WhatsAppArchiveOptions;
  private readonly seen = new Map<string, number>();
  private prunedOn = "";

  constructor(options: WhatsAppArchiveOptions) {
    this.options = options;
  }

  get dir(): string {
    return this.options.dir;
  }

  accept(payload: unknown): WhatsAppAcceptResult {
    const event = str(obj(payload).event);
    const done = Promise.resolve();
    if (!WHATSAPP_MESSAGE_EVENTS.has(event)) return { outcome: "ignored", reason: `Event “${event || "(none)"}” is not a message`, event, done };
    const now = new Date((this.options.now ?? Date.now)());
    const { record, message } = extractRecord(payload, now);
    if (this.duplicate(record.id, now.getTime())) return { outcome: "duplicate", event, done };
    record.raw = stripFat(payload);
    const kind = Object.keys(MEDIA_KINDS).find((candidate) => message[candidate]);
    if (!kind) {
      this.append(record);
      return { outcome: "stored", event, done };
    }
    // Write the message now and the attachment when it is in: a crash or a
    // slow download may cost the file, never the message.
    const media = mediaOf(kind, obj(message[kind]));
    this.append({ ...record, media: { ...media, pending: true } });
    return { outcome: "stored", event, done: this.completeMedia(record, kind, obj(message[kind]), media) };
  }

  private duplicate(id: string, now: number): boolean {
    if (!id) return false;
    for (const [seenId, at] of this.seen) if (now - at > SEEN_WINDOW_MS) this.seen.delete(seenId);
    if (this.seen.has(id)) return true;
    this.seen.set(id, now);
    return false;
  }

  private append(record: WhatsAppRecord): void {
    const chatDir = join(this.options.dir, chatKey(record));
    mkdirSync(chatDir, { recursive: true, mode: 0o700 });
    appendFileSync(join(chatDir, `${brusselsDay(new Date(record.ts))}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 });
    this.prune();
  }

  private async completeMedia(record: WhatsAppRecord, kind: string, raw: Obj, media: WhatsAppMedia): Promise<void> {
    const done = { ...media };
    try {
      if (!this.options.sessionKey) throw new Error("no WasenderAPI session key, cannot decrypt");
      const http = this.options.fetch ?? fetch;
      const body = JSON.stringify({ data: { messages: { key: { id: record.id }, message: { [kind]: raw } } } });
      const decrypt = () => http(`${WASENDER_API}/decrypt-media`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.sessionKey}`, "content-type": "application/json", accept: "application/json" },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      // The decrypt URL lives one hour: fetch now, and retry once on a hiccup.
      let response = await decrypt().catch(() => null);
      if (!response?.ok) response = await decrypt();
      if (!response.ok) throw new Error(`decrypt-media returned HTTP ${response.status}`);
      const url = str(obj(await response.json()).publicUrl);
      if (!url) throw new Error("decrypt-media returned no publicUrl");
      const download = await http(url, { signal: AbortSignal.timeout(60_000) });
      if (!download.ok) throw new Error(`download returned HTTP ${download.status}`);
      const blob = Buffer.from(await download.arrayBuffer());
      if (blob.length > MAX_MEDIA_BYTES) throw new Error(`file larger than ${MAX_MEDIA_BYTES} bytes`);
      const name = `${(record.id || String(Date.now())).toLowerCase().replace(SAFE, "") || "media"}.${extensionFor(kind, media)}`;
      const mediaDir = join(this.options.dir, chatKey(record), "media");
      mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(mediaDir, name), blob, { mode: 0o600 });
      done.file = `${chatKey(record)}/media/${name}`;
      done.bytes = blob.length;
    } catch (error) {
      done.error = error instanceof Error ? error.message : String(error);
    }
    this.append({ ...record, media: done });
    this.options.log?.(`whatsapp ${record.id} ${done.type} ${done.error ? `failed: ${done.error}` : "stored"}`);
    if (done.file && done.type === "audio" && this.options.sonioxKey) {
      const file = join(this.options.dir, done.file);
      try {
        writeFileSync(transcriptPath(file), await sonioxTranscribe(file, this.options.sonioxKey, { fetch: this.options.fetch }), { mode: 0o600 });
      } catch (error) {
        // The reader transcribes it on demand instead.
        this.options.log?.(`whatsapp ${record.id} transcription failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /** Drop what is older than the retention period, once a day. */
  private prune(): void {
    const today = brusselsDay(new Date((this.options.now ?? Date.now)()));
    if (this.prunedOn === today) return;
    this.prunedOn = today;
    const days = this.options.retentionDays ?? 90;
    const cutoffMs = Date.parse(`${today}T00:00:00Z`) - days * 86_400_000;
    const cutoff = new Date(cutoffMs).toISOString().slice(0, 10);
    let chats: string[] = [];
    try {
      chats = readdirSync(this.options.dir);
    } catch {
      return;
    }
    for (const chat of chats) {
      const chatDir = join(this.options.dir, chat);
      try {
        for (const name of readdirSync(chatDir)) {
          if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name) && name.slice(0, 10) < cutoff) rmSync(join(chatDir, name), { force: true });
        }
        const mediaDir = join(chatDir, "media");
        for (const name of readdirSync(mediaDir, { withFileTypes: true }).map((entry) => entry.name)) {
          if (statSync(join(mediaDir, name)).mtimeMs < cutoffMs) rmSync(join(mediaDir, name), { force: true });
        }
      } catch {
        // a chat without media, or one being written: next day again
      }
    }
  }
}
