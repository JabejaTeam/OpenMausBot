// Workspace rules by kind of bot: one text for every bot and one per kind
// (code agents, client project managers), kept by an admin and read at every turn. The single source for how
// bots work, so no rule is copied into a bot's own standing instructions.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";
import { sectionContextSystemPrompt } from "./section-context.ts";
import { BOT_KINDS, type BotKind } from "../shared/wire.ts";

export const KIND_INSTRUCTIONS_MAX_BYTES = 24_000;
export const KIND_INSTRUCTIONS_FILE = join(DATA_DIR, "kind-instructions.json");

/** `everyone` reaches every bot, `others` every bot except code agents, and a
 * kind the bots of that kind. */
export const KIND_INSTRUCTION_SCOPES = ["everyone", "others", ...BOT_KINDS] as const;
export type KindInstructionScope = (typeof KIND_INSTRUCTION_SCOPES)[number];

export interface KindInstructionRecord { text: string; updatedAt: number }

const recordSchema = z.object({ text: z.string(), updatedAt: z.number().finite() });
const fileSchema = z.object({ version: z.literal(1), scopes: z.record(z.string(), recordSchema) });

export function isKindInstructionScope(value: unknown): value is KindInstructionScope {
  return typeof value === "string" && (KIND_INSTRUCTION_SCOPES as readonly string[]).includes(value);
}

function load(forWrite = false): Partial<Record<KindInstructionScope, KindInstructionRecord>> {
  if (!existsSync(KIND_INSTRUCTIONS_FILE)) return {};
  try {
    const parsed = fileSchema.parse(JSON.parse(readFileSync(KIND_INSTRUCTIONS_FILE, "utf8")));
    const out: Partial<Record<KindInstructionScope, KindInstructionRecord>> = {};
    for (const scope of KIND_INSTRUCTION_SCOPES) {
      const record = parsed.scopes[scope];
      if (record && Buffer.byteLength(record.text, "utf8") <= KIND_INSTRUCTIONS_MAX_BYTES) out[scope] = record;
    }
    return out;
  } catch {
    if (forWrite) throw new Error("Saved role instructions could not be read; the existing file was left unchanged");
    return {};
  }
}

export function readKindInstructions(): Partial<Record<KindInstructionScope, KindInstructionRecord>> {
  return load();
}

/** Empty text clears the scope. */
export function writeKindInstructions(scope: KindInstructionScope, text: string, now = Date.now()): KindInstructionRecord | null {
  if (Buffer.byteLength(text, "utf8") > KIND_INSTRUCTIONS_MAX_BYTES) {
    throw new Error(`role instructions are capped at ${KIND_INSTRUCTIONS_MAX_BYTES} bytes`);
  }
  const scopes = load(true);
  if (text.trim()) scopes[scope] = { text, updatedAt: now };
  else delete scopes[scope];
  mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  writeFileAtomic(KIND_INSTRUCTIONS_FILE, JSON.stringify({ version: 1, scopes }, null, 2), { mode: 0o600 });
  return scopes[scope] ?? null;
}

const KIND_LABEL: Record<BotKind, string> = { code: "code agents", pm: "client project managers", test: "test agents (they test roadmap test cards on a test environment)" };

/** Code agents work from the assignment their project manager gives them.
 * The team's shared knowledge (section context: kennisbank, Werkwijze-synthese)
 * and automatic recall stay with the bots that talk to people and coordinate;
 * the PM passes on what the code agent needs. The one place that decides it. */
export function kindTakesTeamKnowledge(kind?: BotKind): boolean {
  return kind !== "code";
}

/** The section-context block a bot of this kind gets, or "". */
export function teamContextPrompt(bot: { section?: string | null; kind?: BotKind }): string {
  return kindTakesTeamKnowledge(bot.kind) ? sectionContextSystemPrompt(bot.section) : "";
}

/** The workspace rules for one bot, as system-prompt blocks. They come from
 * the admin, so they win over conflicting working rules the bot got anywhere
 * else: its own standing instructions, whoever created it, its memory, or a
 * repository's AGENTS.md / CLAUDE.md. Safety boundaries are not touched. */
export function kindInstructionsSystemPrompt(kind?: BotKind): string {
  const scopes = load();
  const block = (scope: KindInstructionScope, intro: string) => {
    const text = scopes[scope]?.text.trim();
    if (!text) return "";
    return `\n\n${intro}\n\n--- BEGIN WORKSPACE RULES (${scope}) ---\n${text}\n--- END WORKSPACE RULES (${scope}) ---`;
  };
  return block("everyone",
    "Workspace rules for every bot follow. The workspace admin sets them and you cannot edit them. Where they conflict with working rules in your own instructions, your memory or a repository file, these rules win.")
    + (kind !== "code" ? block("others",
      "Workspace rules for every bot except the code agents follow. The workspace admin sets them and you cannot edit them; they win the same way.") : "")
    + (kind ? block(kind,
      `You are one of this workspace's ${KIND_LABEL[kind]}. The rules below are the only working rules for how you do that work. They win over any conflicting working rule in your own standing instructions (including what the bot or person who created you wrote), your memory, and repository files such as AGENTS.md or CLAUDE.md. Your own instructions still say which project, client or repository you work on.`) : "");
}
