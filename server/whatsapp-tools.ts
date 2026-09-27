import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { sonioxTranscribe } from "./soniox.ts";
import { transcriptPath, type WhatsAppRecord } from "./whatsapp-archive.ts";

/** The read side of the WhatsApp archive (whatsapp-archive.ts), served as MCP
 * tools by whatsapp-mcp.ts. Nothing here writes to the archive except the
 * transcript next to a voice note. Voice notes read as text: whatever a tool
 * shows that has no transcript yet is transcribed in the same call. */

const MAX_TEXT = 4_000;
const TRANSCRIBE_PER_CALL = 6;
const TRANSCRIBE_PARALLEL = 3;
const KINDS = ["voice", "image", "video", "document", "text"] as const;
type Kind = (typeof KINDS)[number];

export interface WhatsAppToolOptions {
  dir: string;
  sonioxKey?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

export interface WhatsAppTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

function brusselsDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function brusselsTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "??:??";
  return new Intl.DateTimeFormat("nl-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function kindOf(record: WhatsAppRecord): Kind {
  const media = record.media;
  if (!media) return "text";
  if (media.type === "audio") return "voice";
  if (media.type === "image" || media.type === "sticker") return "image";
  if (media.type === "video") return "video";
  if (media.mime?.startsWith("image/")) return "image";
  if (media.mime?.startsWith("audio/")) return "voice";
  if (media.mime?.startsWith("video/")) return "video";
  return "document";
}

function kindLabel(record: WhatsAppRecord): string {
  const media = record.media!;
  if (media.type === "audio") return media.ptt ? "voice note" : "audio file";
  if (media.type === "sticker") return "sticker";
  if (media.type === "video") return media.gif ? "GIF" : "video";
  if (media.type === "image") return "photo";
  const kind = kindOf(record);
  return kind === "document" ? "document" : `${kind} (sent as document)`;
}

const KIND_ALIASES: Record<string, Kind> = {
  voice: "voice", audio: "voice", spraak: "voice", spraakbericht: "voice",
  image: "image", photo: "image", foto: "image", sticker: "image",
  video: "video", gif: "video",
  document: "document", pdf: "document", file: "document", bestand: "document",
  text: "text", tekst: "text",
};

export function createWhatsAppTools(options: WhatsAppToolOptions) {
  const { dir } = options;
  const now = () => new Date((options.now ?? Date.now)());

  const chats = (): string[] => {
    try {
      return readdirSync(dir).filter((name) => !name.startsWith(".") && statSync(join(dir, name)).isDirectory()).sort();
    } catch {
      return [];
    }
  };
  const days = (chat: string): string[] => {
    try {
      return readdirSync(join(dir, chat)).filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).map((name) => name.slice(0, 10)).sort();
    } catch {
      return [];
    }
  };
  /** One day's messages, the last line per id winning: a message is written
   * again once its attachment is in. */
  const readDay = (chat: string, day: string): WhatsAppRecord[] => {
    let text = "";
    try {
      text = readFileSync(join(dir, chat, `${day}.jsonl`), "utf8");
    } catch {
      return [];
    }
    const byId = new Map<string, WhatsAppRecord>();
    let anonymous = 0;
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as WhatsAppRecord;
        const id = record.id || `_${anonymous++}`;
        byId.delete(id);
        byId.set(id, record);
      } catch {
        // a torn last line while the archive writes
      }
    }
    return [...byId.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  };
  const recentDays = (count: number): Set<string> => {
    const out = new Set<string>();
    for (let index = 0; index < Math.max(1, count); index++) out.add(brusselsDay(new Date(now().getTime() - index * 86_400_000)));
    return out;
  };
  const filePath = (record: WhatsAppRecord): string => (record.media?.file ? join(dir, record.media.file) : "");
  const transcript = (record: WhatsAppRecord): string | null => {
    const file = filePath(record);
    if (!file || kindOf(record) !== "voice") return null;
    try {
      return readFileSync(transcriptPath(file), "utf8");
    } catch {
      return null;
    }
  };

  /** Transcribe the voice notes about to be shown. Returns a note about what
   * was left for next time, so a cap never reads as an empty message. */
  const transcribeShown = async (records: WhatsAppRecord[]): Promise<string> => {
    if (!options.sonioxKey) return "";
    const todo = records.filter((record) => kindOf(record) === "voice" && filePath(record) && existsSync(filePath(record)) && transcript(record) === null);
    const batch = todo.slice(0, TRANSCRIBE_PER_CALL);
    for (let start = 0; start < batch.length; start += TRANSCRIBE_PARALLEL) {
      await Promise.all(batch.slice(start, start + TRANSCRIBE_PARALLEL).map(async (record) => {
        const file = filePath(record);
        try {
          writeFileSync(transcriptPath(file), await sonioxTranscribe(file, options.sonioxKey!, { fetch: options.fetch }), { mode: 0o600 });
        } catch {
          // shown as not transcribed; the next read tries again
        }
      }));
    }
    const left = todo.length - batch.length;
    return left > 0 ? `\n(${left} voice note(s) could not be transcribed in this call; ask for the same list again)` : "";
  };

  const attachment = (record: WhatsAppRecord): string => {
    const media = record.media!;
    const label = kindLabel(record);
    if (media.pending) return `<${label}, still downloading>`;
    if (media.error) return `<${label} MISSING: ${media.error.slice(0, 120)}>`;
    const seconds = media.seconds ? ` ${media.seconds}s` : "";
    if (kindOf(record) === "voice") {
      const said = transcript(record);
      if (said !== null) return `<${label}${seconds}> ${said.slice(0, MAX_TEXT) || "(no intelligible speech)"}`;
      return `<${label}${seconds}, not transcribed yet — whatsapp_media id=${record.id}>`;
    }
    return `<${label}${media.name ? ` '${media.name}'` : ""}${seconds} — ${filePath(record)}>`;
  };
  const line = (record: WhatsAppRecord): string => {
    const who = record.dir === "out" ? "Wiebren" : record.sender_name || record.sender || "?";
    const parts = [`[${brusselsTime(record.ts)}] ${who}:`];
    if (record.media) {
      parts.push(attachment(record));
      if (record.media.caption) parts.push(`caption: ${record.media.caption.slice(0, MAX_TEXT)}`);
    }
    if (record.text) parts.push(record.text.slice(0, MAX_TEXT));
    return parts.join(" ");
  };
  const legend = (records: WhatsAppRecord[]): string => {
    const kinds = new Set(records.filter((record) => record.media?.file).map(kindOf));
    const hints = [
      (kinds.has("image") || kinds.has("document")) && "Photos and documents are files on disk: open the path with your file-reading tool (it shows images and reads PDFs).",
      kinds.has("video") && "A video is a file on disk; whatsapp_media tells what else is known about it.",
    ].filter(Boolean);
    return hints.length ? `\n${hints.join(" ")}` : "";
  };
  const kindFilter = (value: unknown): { kind?: Kind; error?: string } => {
    const raw = String(value ?? "").trim().toLowerCase();
    if (!raw) return {};
    const kind = KIND_ALIASES[raw];
    return kind ? { kind } : { error: `Unknown kind '${raw}' — choose from ${KINDS.join(", ")}` };
  };
  const nameOf = (records: WhatsAppRecord[]): string | null =>
    [...records].reverse().find((record) => record.dir === "in" && record.sender_name)?.sender_name ?? null;

  const kindSchema = { type: "string", description: `Only one kind of message: ${KINDS.join(", ")}.` };

  const tools: WhatsAppTool[] = [
    {
      name: "whatsapp_chats",
      description: "Which WhatsApp chats had messages recently, with the last message of each. Start here: the chat names it returns are the `chat` value for the other tools. This is Wiebren's own WhatsApp number, incoming and outgoing.",
      inputSchema: { type: "object", properties: { days: { type: "integer", description: "How many days back (default 7)." }, kind: kindSchema } },
      run: async (args) => {
        const count = Number(args.days) || 7;
        const { kind, error } = kindFilter(args.kind);
        if (error) return error;
        const window = recentDays(count);
        const rows: Array<{ chat: string; name: string | null; count: number; lastDay: string; last: WhatsAppRecord }> = [];
        for (const chat of chats()) {
          const inWindow = days(chat).filter((day) => window.has(day));
          const records = inWindow.flatMap((day) => readDay(chat, day)).filter((record) => !kind || kindOf(record) === kind);
          if (!records.length) continue;
          rows.push({ chat, name: nameOf(records), count: records.length, lastDay: inWindow[inWindow.length - 1]!, last: records[records.length - 1]! });
        }
        if (!rows.length) return `No ${kind ? `${kind} ` : ""}messages in the last ${count} days.`;
        rows.sort((a, b) => b.last.ts.localeCompare(a.last.ts));
        const note = await transcribeShown(rows.map((row) => row.last));
        return [
          `Chats of the last ${count} days${kind ? ` (only ${kind})` : ""}:`,
          ...rows.flatMap((row) => [
            `- ${row.chat}${row.name ? ` — ${row.name}` : ""} (${row.chat.startsWith("group-") ? "group" : "direct"}, ${row.count} messages, last ${row.lastDay})`,
            `    ${line(row.last).slice(0, 240)}`,
          ]),
        ].join("\n") + note;
      },
    },
    {
      name: "whatsapp_read",
      description: "Read one chat, by default its last day with messages. Voice notes appear as text. Give `date` (YYYY-MM-DD) for another day and `kind` to narrow it down.",
      inputSchema: {
        type: "object",
        properties: {
          chat: { type: "string", description: "Phone number without plus (32488580699) or group-<id>, from whatsapp_chats." },
          date: { type: "string", description: "YYYY-MM-DD. Omit for the last day with messages." },
          limit: { type: "integer", description: "At most this many messages, the latest (default 50)." },
          kind: kindSchema,
        },
        required: ["chat"],
      },
      run: async (args) => {
        const chat = String(args.chat ?? "").trim();
        if (!chat) return "Give `chat` — whatsapp_chats lists them.";
        if (!chats().includes(chat)) return `Unknown chat '${chat}'. Use whatsapp_chats or whatsapp_search to find it.`;
        const all = days(chat);
        const date = String(args.date ?? "").trim();
        if (date && !all.includes(date)) return `No messages on ${date} in ${chat}. Days with messages: ${all.slice(-14).join(", ")}`;
        const day = date || all[all.length - 1];
        if (!day) return `No messages in ${chat}.`;
        const { kind, error } = kindFilter(args.kind);
        if (error) return error;
        const records = readDay(chat, day).filter((record) => !kind || kindOf(record) === kind);
        const shown = records.slice(-(Number(args.limit) || 50));
        const note = await transcribeShown(shown);
        const other = all.filter((candidate) => candidate !== day).slice(-14);
        return [
          `${chat} — ${day} (${shown.length} of ${records.length} messages${kind ? `, only ${kind}` : ""})`,
          ...shown.map(line),
        ].join("\n")
          + legend(shown)
          + (shown.length < records.length ? "\n(earlier messages of this day left out; raise `limit`)" : "")
          + note
          + (other.length ? `\nOther days with messages: ${other.join(", ")}` : "");
      },
    },
    {
      name: "whatsapp_search",
      description: "Search the whole archive by text, name, number or file name — transcribed voice notes included. Use it when you do not know which chat something was in. With only `kind` you get every message of that kind.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          chat: { type: "string", description: "Only this chat." },
          days: { type: "integer", description: "How many days back (default 30)." },
          limit: { type: "integer", description: "At most this many hits, the latest (default 30)." },
          kind: kindSchema,
        },
      },
      run: async (args) => {
        const query = String(args.query ?? "").trim().toLowerCase();
        const { kind, error } = kindFilter(args.kind);
        if (error) return error;
        if (!query && !kind) return "Give `query`, or `kind` for every message of one kind.";
        const only = String(args.chat ?? "").trim();
        const count = Number(args.days) || 30;
        const window = recentDays(count);
        const hits: Array<{ chat: string; day: string; record: WhatsAppRecord }> = [];
        for (const chat of chats()) {
          if (only && chat !== only) continue;
          for (const day of days(chat)) {
            if (!window.has(day)) continue;
            for (const record of readDay(chat, day)) {
              if (kind && kindOf(record) !== kind) continue;
              if (query) {
                const hay = [record.text, record.media?.caption, record.media?.name, transcript(record), record.sender_name, record.sender, chat]
                  .filter(Boolean).join(" ").toLowerCase();
                if (!hay.includes(query)) continue;
              }
              hits.push({ chat, day, record });
            }
          }
        }
        if (!hits.length) {
          return `Nothing found for '${query}'${kind ? ` (kind ${kind})` : ""} in the last ${count} days${only ? ` in ${only}` : ""}. That does not mean it was never sent: a voice note that is not transcribed yet is not searchable — open its day with whatsapp_read.`;
        }
        hits.sort((a, b) => a.record.ts.localeCompare(b.record.ts));
        const shown = hits.slice(-(Number(args.limit) || 30));
        const note = await transcribeShown(shown.map((hit) => hit.record));
        return [
          `${hits.length} hit(s)${shown.length < hits.length ? `, latest ${shown.length} shown` : ""}:`,
          ...shown.map((hit) => `${hit.day} ${hit.chat} ${line(hit.record)}`),
        ].join("\n") + legend(shown.map((hit) => hit.record)) + note;
      },
    },
    {
      name: "whatsapp_media",
      description: "The attachment of one message: a voice note comes back as text; a photo, video or document as a file path you open with your own file-reading tool.",
      inputSchema: {
        type: "object",
        properties: { chat: { type: "string" }, id: { type: "string", description: "The message id (from whatsapp_read)." } },
        required: ["chat", "id"],
      },
      run: async (args) => {
        const chat = String(args.chat ?? "").trim();
        const id = String(args.id ?? "").trim();
        if (!chat || !id) return "Give `chat` and `id`.";
        const record = [...days(chat)].reverse().map((day) => readDay(chat, day).find((candidate) => candidate.id === id)).find(Boolean);
        if (!record) return `Message ${id} not found in ${chat}.`;
        const media = record.media;
        if (!media) return `Message ${id} has no attachment.`;
        if (media.pending) return "The attachment is still downloading; try again in a minute.";
        if (media.error) return `The attachment of ${id} is missing: ${media.error}. WasenderAPI's decrypt link lives one hour, so it is gone for good — ask the sender to send it again.`;
        const file = filePath(record);
        if (!existsSync(file)) return `The file is no longer on disk (${file}); the archive keeps 90 days.`;
        const info = { path: file, kind: kindLabel(record), mime: media.mime, name: media.name, seconds: media.seconds, bytes: media.bytes };
        if (kindOf(record) !== "voice") return JSON.stringify({ ...info, hint: "Open `path` with your file-reading tool; do not guess what is in it." }, null, 2);
        await transcribeShown([record]);
        const said = transcript(record);
        if (said === null) return JSON.stringify({ ...info, error: options.sonioxKey ? "Transcription failed; try again." : "No speech-to-text key is configured." }, null, 2);
        return JSON.stringify({ ...info, transcript: said || "(no intelligible speech)" }, null, 2);
      },
    },
  ];
  return tools;
}

const INSTRUCTIONS = "The archive of Wiebren's own WhatsApp number, incoming and outgoing. Messages land here without any bot running; these tools read them only when asked. Voice notes read as text. Start with whatsapp_chats. Sending is not done here: that is the wasender MCP, and it needs Wiebren's explicit ok per message.";

/** One JSON-RPC request → its response, or null for a notification. */
export async function handleWhatsAppMcp(tools: WhatsAppTool[], request: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const id = request.id ?? null;
  const method = String(request.method ?? "");
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "whatsapp", version: "1.0.0" },
      instructions: INSTRUCTIONS,
    } };
  }
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
  }
  if (method === "tools/call") {
    const params = (request.params ?? {}) as Record<string, unknown>;
    const tool = tools.find((candidate) => candidate.name === params.name);
    if (!tool) return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Unknown tool: ${String(params.name)}` }], isError: true } };
    try {
      const text = await tool.run((params.arguments ?? {}) as Record<string, unknown>);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text }] } };
    } catch (error) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true } };
    }
  }
  if (method.startsWith("notifications/")) return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}
