// Fork: when the chat shows a centred time ("Today 22:14") above a message,
// the way Messages does — at the start, on a new day, and after a pause.

/** A pause this long between two messages starts a new time block. */
export const TIME_GAP_MS = 15 * 60_000;

export function startsTimeBlock(previousAt: number | undefined, at: number): boolean {
  if (previousAt === undefined) return true;
  if (new Date(previousAt).toDateString() !== new Date(at).toDateString()) return true;
  return at - previousAt >= TIME_GAP_MS;
}
