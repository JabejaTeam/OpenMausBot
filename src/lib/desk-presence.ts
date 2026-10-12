// Jabeja fork: tells the server this person is working here (the Mac app or
// a browser), so their phone gets no push meanwhile — server/push-gate.ts
// owns the rule. Only real activity counts: a key, a click, a scroll or the
// mouse moving while this window has focus. An app left open in the
// background says nothing, and the phone rings again after a while.

type Send = (path: string, init?: RequestInit) => Promise<unknown>;

const PATH = "/api/push/desk";
/** At most one message per this long; well inside the server's window. */
export const DESK_BEAT_MS = 30_000;
const EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "focus"] as const;

let connected = false;

/** Whether a sign of activity now should be sent: this window has focus and
 * the last one went out long enough ago. */
export function deskBeatDue(lastSentAt: number, now: number, focused: boolean): boolean {
  return focused && now - lastSentAt >= DESK_BEAT_MS;
}

/** Start once per page with the store's authenticated `api`. */
export function connectDeskPresence(request: Send): void {
  if (connected || typeof window === "undefined") return;
  connected = true;
  let lastSentAt = -Infinity;
  const onActivity = () => {
    const now = Date.now();
    if (!deskBeatDue(lastSentAt, now, document.hasFocus())) return;
    lastSentAt = now;
    void request(PATH, { method: "POST" }).catch(() => {});
  };
  for (const event of EVENTS) window.addEventListener(event, onActivity, { passive: true });
  onActivity();
}
