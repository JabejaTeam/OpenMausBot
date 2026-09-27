import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { chatKey, extractRecord, WhatsAppArchive } from "./whatsapp-archive.ts";
import { createWhatsAppTools, handleWhatsAppMcp } from "./whatsapp-tools.ts";

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omb-whatsapp-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const NOW = new Date("2026-09-27T15:06:34.000Z").getTime();

/** The shape WasenderAPI really sends with LID addressing: remoteJid is a
 * LID in both directions, the number sits in cleanedSenderPn. */
function event(options: { id: string; fromMe?: boolean; text?: string; group?: boolean; message?: Record<string, unknown>; name?: string }) {
  return {
    event: "messages.received",
    data: {
      messages: {
        key: {
          id: options.id,
          fromMe: options.fromMe ?? false,
          remoteJid: options.group ? "120363426259641129@g.us" : "50126647255247@lid",
          cleanedSenderPn: "32488580699",
          ...(options.group ? { cleanedParticipantPn: "32470000000" } : {}),
          addressingMode: "lid",
        },
        pushName: options.name ?? "Ripal Be",
        messageBody: options.text ?? "",
        message: options.message ?? { conversation: options.text ?? "" },
      },
    },
  };
}

function lines(dir: string, chat: string): Array<Record<string, unknown>> {
  const chatDir = join(dir, chat);
  return readdirSync(chatDir).filter((name) => name.endsWith(".jsonl")).flatMap((name) =>
    readFileSync(join(chatDir, name), "utf8").trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>));
}

function fakeFetch(routes: Record<string, () => Response>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return routes[route]!();
  }) as typeof fetch;
}

describe("extractRecord", () => {
  it("files both directions of a LID chat under the other party's number", () => {
    const incoming = extractRecord(event({ id: "A", text: "hoi" }), new Date(NOW)).record;
    const outgoing = extractRecord(event({ id: "B", fromMe: true, text: "dag" }), new Date(NOW)).record;
    expect(chatKey(incoming)).toBe("32488580699");
    expect(chatKey(outgoing)).toBe("32488580699");
    expect(incoming).toMatchObject({ dir: "in", sender: "32488580699", sender_name: "Ripal Be", text: "hoi" });
    expect(outgoing).toMatchObject({ dir: "out", sender: "self" });
  });

  it("files a group message under the group, with the participant as sender", () => {
    const { record } = extractRecord(event({ id: "G", group: true, text: "yo" }), new Date(NOW));
    expect(chatKey(record)).toBe("group-120363426259641129");
    expect(record.sender).toBe("32470000000");
  });
});

describe("WhatsAppArchive", () => {
  it("stores messages without a model turn, skips duplicates and non-message events", () => {
    const dir = tempDir();
    const archive = new WhatsAppArchive({ dir, now: () => NOW });
    expect(archive.accept(event({ id: "A", text: "hoi" })).outcome).toBe("stored");
    expect(archive.accept({ ...event({ id: "A", text: "hoi" }), event: "messages.upsert" }).outcome).toBe("duplicate");
    expect(archive.accept({ event: "contacts.update", data: {} }).outcome).toBe("ignored");
    const stored = lines(dir, "32488580699");
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: "A", text: "hoi", dir: "in" });
    expect(readdirSync(join(dir, "32488580699"))).toEqual(["2026-09-27.jsonl"]);
  });

  it("decrypts an attachment, writes it next to the chat, and transcribes a voice note", async () => {
    const dir = tempDir();
    const archive = new WhatsAppArchive({
      dir,
      now: () => NOW,
      sessionKey: "session",
      sonioxKey: "soniox",
      fetch: fakeFetch({
        "https://wasenderapi.com/api/decrypt-media": () => Response.json({ publicUrl: "https://files.example/voice.ogg" }),
        "https://files.example/voice.ogg": () => new Response(new Uint8Array([1, 2, 3])),
        "https://api.soniox.com/v1/files": () => Response.json({ id: "file-1" }),
        "https://api.soniox.com/v1/transcriptions/tr-1/transcript": () => Response.json({ text: "ik zit in de file" }),
        "https://api.soniox.com/v1/transcriptions/tr-1": () => Response.json({ status: "completed" }),
        "https://api.soniox.com/v1/transcriptions": () => Response.json({ id: "tr-1" }),
      }),
    });
    const result = archive.accept(event({ id: "VOICE1", message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", seconds: 11, ptt: true, mediaKey: "secret" } } }));
    expect(result.outcome).toBe("stored");
    // the message is on disk before its attachment is
    expect(lines(dir, "32488580699")[0]).toMatchObject({ id: "VOICE1", media: { type: "audio", pending: true } });
    await result.done;

    const media = join(dir, "32488580699", "media", "voice1.ogg");
    expect(readFileSync(media)).toEqual(Buffer.from([1, 2, 3]));
    expect(readFileSync(`${media}.txt`, "utf8")).toBe("ik zit in de file");
    const last = lines(dir, "32488580699").at(-1)!;
    expect(last).toMatchObject({ media: { file: "32488580699/media/voice1.ogg", bytes: 3, error: null } });
    expect(JSON.stringify(last)).not.toContain("secret");
  });

  it("keeps the message when the attachment cannot be decrypted", async () => {
    const dir = tempDir();
    const archive = new WhatsAppArchive({ dir, now: () => NOW });
    await archive.accept(event({ id: "DOC", message: { documentMessage: { fileName: "offerte.pdf", mimetype: "application/pdf" } } })).done;
    const last = lines(dir, "32488580699").at(-1)!;
    expect(last).toMatchObject({ id: "DOC", media: { name: "offerte.pdf", file: null } });
    expect(String((last.media as Record<string, unknown>).error)).toContain("session key");
  });
});

describe("WhatsApp MCP tools", () => {
  async function call(tools: ReturnType<typeof createWhatsAppTools>, name: string, args: Record<string, unknown> = {}): Promise<string> {
    const response = await handleWhatsAppMcp(tools, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
    const result = response!.result as { content: Array<{ text: string }> };
    return result.content[0]!.text;
  }

  it("lists chats, reads a day with the last line per message winning, and searches transcripts", async () => {
    const dir = tempDir();
    const archive = new WhatsAppArchive({
      dir,
      now: () => NOW,
      sessionKey: "session",
      fetch: fakeFetch({
        "https://wasenderapi.com/api/decrypt-media": () => Response.json({ publicUrl: "https://files.example/v.ogg" }),
        "https://files.example/v.ogg": () => new Response(new Uint8Array([9])),
      }),
    });
    archive.accept(event({ id: "A", text: "zullen we morgen afspreken?" }));
    archive.accept(event({ id: "B", fromMe: true, text: "prima" }));
    await archive.accept(event({ id: "V", message: { audioMessage: { seconds: 4, ptt: true } } })).done;

    const tools = createWhatsAppTools({
      dir,
      now: () => NOW,
      sonioxKey: "soniox",
      fetch: fakeFetch({
        "https://api.soniox.com/v1/files": () => Response.json({ id: "f" }),
        "https://api.soniox.com/v1/transcriptions/t/transcript": () => Response.json({ text: "ik kom om tien uur" }),
        "https://api.soniox.com/v1/transcriptions/t": () => Response.json({ status: "completed" }),
        "https://api.soniox.com/v1/transcriptions": () => Response.json({ id: "t" }),
      }),
    });

    const chats = await call(tools, "whatsapp_chats");
    expect(chats).toContain("32488580699 — Ripal Be (direct, 3 messages");
    expect(chats).toContain("ik kom om tien uur");

    const read = await call(tools, "whatsapp_read", { chat: "32488580699" });
    expect(read).toContain("(3 of 3 messages)");
    expect(read).toContain("[17:06] Ripal Be: zullen we morgen afspreken?");
    expect(read).toContain("Wiebren: prima");
    expect(read).toContain("<voice note 4s> ik kom om tien uur");
    expect(read).not.toContain("still downloading");

    expect(await call(tools, "whatsapp_search", { query: "tien uur" })).toContain("1 hit(s)");
    expect(await call(tools, "whatsapp_search", { kind: "voice" })).toContain("1 hit(s)");
    expect(await call(tools, "whatsapp_read", { chat: "nope" })).toContain("Unknown chat");
    expect(existsSync(join(dir, "32488580699", "media", "v.ogg.txt"))).toBe(true);
  });

  it("answers the MCP handshake", async () => {
    const tools = createWhatsAppTools({ dir: tempDir() });
    const init = await handleWhatsAppMcp(tools, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect((init!.result as { serverInfo: { name: string } }).serverInfo.name).toBe("whatsapp");
    const list = await handleWhatsAppMcp(tools, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect((list!.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name)).toEqual([
      "whatsapp_chats", "whatsapp_read", "whatsapp_search", "whatsapp_media",
    ]);
    expect(await handleWhatsAppMcp(tools, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
  });
});
