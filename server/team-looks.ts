// Jabeja fork: how each team's office looks in the 3D office view — its wall
// colour, and on the back wall its logo or else its name (in a text colour). One file for the workspace, so every
// person sees the same office. Logos arrive as small raster data URLs (the
// browser converts any upload, SVG included, to PNG first): no markup, ever.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import { DATA_DIR } from "./config.ts";

export const TEAM_LOOKS_FILE = join(DATA_DIR, "team-looks.json");
export const TEAM_LOGO_MAX_BYTES = 400_000;

/** A team's office id as the office view knows it: its section, the
 * unsectioned bots, or the chief's own office. */
const teamId = z.string().regex(/^(section:.{1,60}|unassigned|hero)$/s);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const logo = z.string().max(TEAM_LOGO_MAX_BYTES).regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/);

export interface TeamLook { color?: string; logo?: string; textColor?: string; updatedAt: number }

const lookSchema = z.object({ color: color.optional(), logo: logo.optional(), textColor: color.optional(), updatedAt: z.number().finite() });
const fileSchema = z.object({ version: z.literal(1), teams: z.record(z.string(), lookSchema) });

/** null clears that part; absent leaves it. */
export const teamLookPatchSchema = z.object({
  color: color.nullable().optional(),
  logo: logo.nullable().optional(),
  textColor: color.nullable().optional(),
}).strict();

export function readTeamLooks(): Record<string, TeamLook> {
  if (!existsSync(TEAM_LOOKS_FILE)) return {};
  try {
    const parsed = fileSchema.parse(JSON.parse(readFileSync(TEAM_LOOKS_FILE, "utf8")));
    return Object.fromEntries(Object.entries(parsed.teams).filter(([id]) => teamId.safeParse(id).success));
  } catch {
    return {};
  }
}

/** Apply a patch to one team; returns every team's look, or an error. */
export function writeTeamLook(id: string, patch: unknown): { ok: true; teams: Record<string, TeamLook> } | { ok: false; error: string } {
  if (!teamId.safeParse(id).success) return { ok: false, error: "Unknown team" };
  const parsed = teamLookPatchSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: "Give a colour as #rrggbb and a logo as a PNG, JPEG or WebP image of at most 400 KB" };
  const teams = readTeamLooks();
  const next: TeamLook = { ...teams[id], updatedAt: Date.now() };
  for (const key of ["color", "logo", "textColor"] as const) {
    const value = parsed.data[key];
    if (value === null) delete next[key];
    else if (value !== undefined) next[key] = value;
  }
  if (next.color === undefined && next.logo === undefined && next.textColor === undefined) delete teams[id];
  else teams[id] = next;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileAtomic(TEAM_LOOKS_FILE, `${JSON.stringify({ version: 1, teams }, null, 2)}\n`);
  return { ok: true, teams };
}
