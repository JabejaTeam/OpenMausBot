// Office view (fork): the rules every camera move follows, so a stutter can't
// sneak back in. (1) Time advances by frames, capped: a slow frame (the chat
// rendering, a GC) slows a move down but never makes it jump. Never drive a
// move by wall time. (2) The view's shift for the side panel follows the
// camera's own progress, so the bot glides to the middle in one movement.
// (3) Opening a panel is one movement: slide and flight share PANEL_MOVE_MS
// and the same curve. (OfficeView adds (4): it starts that movement only once
// the chat has rendered.)

/** The longest step one frame may advance a move, in ms (one 30 fps frame). */
export const MAX_STEP_MS = 1000 / 30;

/** Elapsed time of a move after a frame of `deltaMs`. */
export function advance(elapsedMs: number, deltaMs: number): number {
  return elapsedMs + Math.min(Math.max(0, deltaMs), MAX_STEP_MS);
}

/** 0..1 progress of a move of `durationMs`. */
export function progressOf(elapsedMs: number, durationMs: number): number {
  return durationMs > 0 ? Math.min(1, elapsedMs / durationMs) : 1;
}

/** Ease in and out: a calm start and a soft landing. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The same curve for CSS (easeInOutCubic), so the side panel's slide and
 * the camera move as one: same curve, same time. A panel on a curve of its
 * own (say one that is mostly in after 150 ms) reads as a jolt. */
export const EASE_IN_OUT_CSS = "cubic-bezier(0.65, 0, 0.35, 1)";

/** Opening (and closing) a bot's panel: the slide and the flight both take this. */
export const PANEL_MOVE_MS = 700;

/**
 * The view's shift (px) while the camera flies to a bot whose panel opens.
 * Not a curve of its own: it is solved each frame so the bot's on-screen x
 * glides straight from where it was clicked to the middle of what stays
 * visible — a shift of `s` moves everything left by s/2, so
 * s = 2 × (where the camera alone puts it − where it should be now).
 * Clamped to [0, panel width]. (Easing the shift by itself overshoots: the
 * camera's perspective motion is not linear.)
 */
export function glideShift(cameraX: number, startX: number, endX: number, eased: number, panelPx: number): number {
  const want = startX + (endX - startX) * eased;
  return Math.round(Math.min(panelPx, Math.max(0, 2 * (cameraX - want))));
}
