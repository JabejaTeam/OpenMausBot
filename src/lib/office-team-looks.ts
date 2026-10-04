// Office view (fork): how a team's office looks — its wall colour (picked, or
// a calm default) and its logo. The looks themselves live on the server
// (/api/team-looks, server/team-looks.ts) so everyone sees the same office.

import type { OfficeLayout } from "./office-layout";

export interface TeamLook {
  color?: string;
  logo?: string;
  /** the name on the wall when there is no logo; a logo brings its own colours */
  textColor?: string;
  updatedAt?: number;
}

/** Calm walls for teams that have not picked a colour (by order). */
export const DEFAULT_WALL_COLORS = ["#d9dde3", "#e3ddd3", "#d5e0d8", "#dcd8e4", "#e5d9d6", "#d6dfe3"];

/** The swatches offered: the calm ones, then bolder accent walls. */
export const TEAM_WALL_SWATCHES = [
  ...DEFAULT_WALL_COLORS,
  "#2f6fde", "#14a3a3", "#2e8b57", "#e0a526", "#d9822b", "#c2453a", "#b4508f", "#7d5ba6", "#3b3f46",
];

export function wallColorFor(roomId: string, index: number, looks: Record<string, TeamLook>): string {
  return looks[roomId]?.color ?? DEFAULT_WALL_COLORS[index % DEFAULT_WALL_COLORS.length];
}

/** Agents wear their team's wall colour: everyone in an office matches its
 * walls (the same pick as the walls, so they change together). */
export function agentColorsFor(layout: Pick<OfficeLayout, "rooms" | "desks">, looks: Record<string, TeamLook>): Map<string, string> {
  const colors = new Map<string, string>();
  layout.rooms.forEach((room, index) => {
    const color = wallColorFor(room.id, index, looks);
    for (const seat of layout.desks.find((desk) => desk.id === room.id)?.seats ?? []) colors.set(seat.botId, color);
  });
  return colors;
}

/** Light walls get dark writing, dark walls light (for anything drawn on them). */
export function isDarkWall(color: string): boolean {
  const value = parseInt(color.slice(1), 16);
  const luminance = (((value >> 16) & 255) * 0.299 + ((value >> 8) & 255) * 0.587 + (value & 255) * 0.114) / 255;
  return luminance < 0.55;
}

/** The colours offered for a name on the wall: neutrals, then the accents. */
export const TEAM_TEXT_SWATCHES = ["#ffffff", "#f5f5f7", "#d1d1d6", "#8e8e93", "#3a3a3c", "#1d1d1f", ...TEAM_WALL_SWATCHES.slice(DEFAULT_WALL_COLORS.length, -1)];

/** What hangs on a team's back wall: its logo, or else its name, written in
 * its own text colour or one that reads on the wall. */
export type WallSign = { kind: "logo"; source: string } | { kind: "name"; text: string; color: string };
export function wallSignFor(label: string, look: TeamLook | undefined, wallColor: string): WallSign {
  if (look?.logo) return { kind: "logo", source: look.logo };
  return { kind: "name", text: label, color: look?.textColor ?? (isDarkWall(wallColor) ? "#ffffff" : "#1d1d1f") };
}

/** One key per look, so the scene only redraws walls when a look changed. */
export function looksKey(looks: Record<string, TeamLook>): string {
  return Object.entries(looks).map(([id, look]) => `${id}:${look.color ?? ""}:${look.textColor ?? ""}:${look.updatedAt ?? 0}`).sort().join("|");
}

/** How big a logo hangs on the back wall (metres): big — up to 72% of the
 * wall (7 m at most, the corner shelf and plant stay clear) and 2.2 m tall
 * (of 2.7), so it reads from across the building
 * like a real office sign. A wide wordmark fills the width, a square mark
 * the height. A name on the wall is lettering: at most NAME_MAX_HEIGHT. */
export const LOGO_MAX_HEIGHT = 2.2;
export const NAME_MAX_HEIGHT = 1.2;
export function logoSize(aspect: number, wallWidth: number, maxHeight = LOGO_MAX_HEIGHT): { width: number; height: number } {
  const safeAspect = Math.max(0.2, aspect);
  const width = Math.min(wallWidth * 0.72, 7, maxHeight * safeAspect);
  return { width, height: width / safeAspect };
}
