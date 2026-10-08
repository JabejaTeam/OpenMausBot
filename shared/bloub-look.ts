/**
 * A bot's drawn avatar look: bloub's body shape, rest expression and colour
 * (https://github.com/jeremy-prt/bloub, vendored in src/vendor/bloub).
 *
 * The id lists live here, not in the vendored engine, because the server
 * validates them and shared/ must not import client code. A test
 * (src/lib/bloub-look-parity.test.ts) keeps them equal to the engine's
 * SHAPES / EXPRESSIONS / COLORS.
 */

import { z } from "zod";

import type { MausColor } from "./wire.ts";

/** In the order bloub's customiser shows them. */
export const BLOUB_SHAPE_IDS = ["cercle", "galet", "squircle", "capsule", "triangle", "hexagone", "nuage", "goutte"] as const;

export const BLOUB_EXPRESSION_IDS = [
  "neutre", "attentif", "surpris", "excite", "heureux", "hilare", "colere", "triste",
  "effraye", "mefiant", "confus", "curieux", "fier", "timide", "blase", "somnolent",
] as const;

export const BLOUB_COLOR_IDS = [
  "encre", "brun", "rouge", "orange", "ambre", "vert", "turquoise", "bleu", "violet", "rose", "gris", "creme",
] as const;

export type BloubShapeId = (typeof BLOUB_SHAPE_IDS)[number];
export type BloubExpressionId = (typeof BLOUB_EXPRESSION_IDS)[number];
export type BloubColorId = (typeof BLOUB_COLOR_IDS)[number];

export interface BloubLook {
  shape: BloubShapeId;
  expression: BloubExpressionId;
  color: BloubColorId;
}

export const bloubLookSchema = z.object({
  shape: z.enum(BLOUB_SHAPE_IDS),
  expression: z.enum(BLOUB_EXPRESSION_IDS),
  color: z.enum(BLOUB_COLOR_IDS),
}).strict();

/** What a backup or package may carry: bounded text, validated with
 * parseBloubLook where it becomes a bot (like mascotBody), so a stale id
 * never rejects a whole import over a cosmetic field. */
export const bloubLookTransportSchema = z.object({
  shape: z.string().max(40),
  expression: z.string().max(40),
  color: z.string().max(40),
});

/** The bot colour's nearest bloub colour. Ten bot colours onto bloub's eight
 * hues: cyan and teal both land on turquoise, red and coral both on rouge. */
export const BLOUB_COLOR_FOR_MAUS: Record<MausColor, BloubColorId> = {
  green: "vert",
  blue: "bleu",
  red: "rouge",
  orange: "orange",
  purple: "violet",
  cyan: "turquoise",
  pink: "rose",
  yellow: "ambre",
  teal: "turquoise",
  coral: "rouge",
};

/** Runtime-safe read of an untrusted persisted or streamed look; null when
 * it is not a complete, known look. */
export function parseBloubLook(value: unknown): BloubLook | null {
  return bloubLookSchema.safeParse(value).data ?? null;
}

/** The look to draw: the stored one, field by field where it is valid, else
 * a default (circle, neutral face, the bot's colour) so bots nobody has
 * styled still look distinct. */
export function bloubLookFor(bot: { color: MausColor; bloub?: Partial<Record<keyof BloubLook, unknown>> | null }): BloubLook {
  const stored = bot.bloub ?? {};
  return {
    shape: bloubLookSchema.shape.shape.safeParse(stored.shape).data ?? "cercle",
    expression: bloubLookSchema.shape.expression.safeParse(stored.expression).data ?? "neutre",
    color: bloubLookSchema.shape.color.safeParse(stored.color).data ?? BLOUB_COLOR_FOR_MAUS[bot.color] ?? "bleu",
  };
}
