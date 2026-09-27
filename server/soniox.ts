import { readFileSync } from "node:fs";
import { basename } from "node:path";

/** Speech to text through Soniox's async file API: upload, create a
 * transcription, poll until it is done, fetch the text. Shared by the
 * WhatsApp archive (transcribes a voice note as it arrives) and the WhatsApp
 * MCP (transcribes one that arrived before a key was set). */

const BASE_URL = "https://api.soniox.com/v1";
const MODEL = "stt-async-v5";
const LANGUAGE_HINTS = ["nl", "en"];

export interface SonioxOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Names and jargon that help the recogniser. */
  context?: string;
}

async function checked(response: Response, stage: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`Soniox ${stage} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  const body: unknown = await response.json();
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

export async function sonioxTranscribe(file: string, apiKey: string, options: SonioxOptions = {}): Promise<string> {
  const http = options.fetch ?? fetch;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);
  const auth = { authorization: `Bearer ${apiKey}` };
  let fileId = "";
  let transcriptionId = "";
  try {
    const form = new FormData();
    form.append("file", new Blob([readFileSync(file)]), basename(file));
    fileId = String((await checked(await http(`${BASE_URL}/files`, { method: "POST", headers: auth, body: form }), "upload")).id ?? "");
    if (!fileId) throw new Error("Soniox returned no file id");

    const created = await checked(await http(`${BASE_URL}/transcriptions`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        file_id: fileId,
        model: MODEL,
        language_hints: LANGUAGE_HINTS,
        ...(options.context ? { context: { text: options.context.slice(0, 10_000) } } : {}),
      }),
    }), "create");
    transcriptionId = String(created.id ?? "");
    if (!transcriptionId) throw new Error("Soniox returned no transcription id");

    let delay = 400;
    for (;;) {
      const state = await checked(await http(`${BASE_URL}/transcriptions/${transcriptionId}`, { headers: auth }), "status");
      const status = String(state.status ?? "").toLowerCase();
      if (status === "completed") break;
      if (status === "error") throw new Error(`Soniox could not transcribe: ${String(state.error_message ?? "no reason given")}`);
      if (Date.now() >= deadline) throw new Error(`Soniox was not done in time (status: ${status || "unknown"})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.6, 2_000);
    }

    const transcript = await checked(await http(`${BASE_URL}/transcriptions/${transcriptionId}/transcript`, { headers: auth }), "transcript");
    return String(transcript.text ?? "").trim();
  } finally {
    // Soniox keeps uploads and transcriptions until they are deleted.
    if (transcriptionId) await http(`${BASE_URL}/transcriptions/${transcriptionId}`, { method: "DELETE", headers: auth }).catch(() => undefined);
    if (fileId) await http(`${BASE_URL}/files/${fileId}`, { method: "DELETE", headers: auth }).catch(() => undefined);
  }
}
