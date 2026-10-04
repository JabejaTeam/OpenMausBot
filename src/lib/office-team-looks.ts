// Office view (fork): how a team's office looks — its wall colour (picked, or
// a calm default) and its logo. The looks themselves live on the server
// (/api/team-looks, server/team-looks.ts) so everyone sees the same office.

export interface TeamLook {
  color?: string;
  logo?: string;
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

/** Light walls get dark writing, dark walls light (for anything drawn on them). */
export function isDarkWall(color: string): boolean {
  const value = parseInt(color.slice(1), 16);
  const luminance = (((value >> 16) & 255) * 0.299 + ((value >> 8) & 255) * 0.587 + (value & 255) * 0.114) / 255;
  return luminance < 0.55;
}

/** One key per look, so the scene only redraws walls when a look changed. */
export function looksKey(looks: Record<string, TeamLook>): string {
  return Object.entries(looks).map(([id, look]) => `${id}:${look.color ?? ""}:${look.updatedAt ?? 0}`).sort().join("|");
}
