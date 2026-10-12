// Jabeja fork: when a notification may ring on a person's phone (server/apns.ts).
// Like Slack: someone working at a desk (the Mac app or a browser, see
// src/lib/desk-presence.ts) gets no phone push — the desk shows it. A push
// waits a moment and goes out only once the person has been away from every
// desk for a while; reading the conversation anywhere cancels it. A push
// that did go out is cleared from the phone again when they read it.
import type { Notification } from "../shared/notification.ts";

/** A desk counts as in use this long after its last sign of activity. */
export const DESK_ACTIVE_MS = 2 * 60_000;
/** A push waits at least this long, so reading it at once never rings. */
export const PUSH_DELAY_MS = 30_000;

export interface PushGateDeps {
  /** Send the notification to the person's phones; how many got it. */
  push(person: string, notification: Notification): Promise<number>;
  /** Take a delivered notification for this conversation off their phones. */
  clear(person: string, threadId: string): Promise<unknown>;
  now?(): number;
  setTimer?(run: () => void, ms: number): unknown;
  clearTimer?(timer: unknown): void;
}

interface Pending {
  notification: Notification;
  timer: unknown;
}

const key = (person: string, threadId: string) => `${person}\0${threadId}`;

export class PushGate {
  private readonly deskAt = new Map<string, number>();
  private readonly pending = new Map<string, Pending>();
  /** Conversations with a push on the person's phone that they have not read. */
  private readonly onPhone = new Set<string>();
  private readonly deps: PushGateDeps;

  constructor(deps: PushGateDeps) {
    this.deps = deps;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** The person did something at a desk just now. */
  noteDesk(person: string): void {
    this.deskAt.set(person, this.now());
  }

  /** How long until the person counts as away from their desks; 0 = away. */
  private deskLeft(person: string): number {
    const at = this.deskAt.get(person);
    return at === undefined ? 0 : Math.max(0, at + DESK_ACTIVE_MS - this.now());
  }

  /** A notification for this person: maybe a push, later. The newest
   * notification of a conversation replaces a waiting one. */
  notify(person: string | undefined, notification: Notification): void {
    if (!person) return;
    const id = key(person, notification.threadId);
    const waiting = this.pending.get(id);
    if (waiting) {
      waiting.notification = notification;
      return;
    }
    this.pending.set(id, { notification, timer: this.schedule(person, id, PUSH_DELAY_MS) });
  }

  /** The person read this conversation: no push for it, and none left on the phone. */
  read(person: string | undefined, threadId: string): void {
    if (!person) return;
    const id = key(person, threadId);
    const waiting = this.pending.get(id);
    if (waiting) {
      if (this.deps.clearTimer) this.deps.clearTimer(waiting.timer);
      else clearTimeout(waiting.timer as ReturnType<typeof setTimeout>);
      this.pending.delete(id);
    }
    if (this.onPhone.delete(id)) void this.deps.clear(person, threadId).catch(() => {});
  }

  private schedule(person: string, id: string, ms: number): unknown {
    const run = () => this.due(person, id);
    if (this.deps.setTimer) return this.deps.setTimer(run, ms);
    const timer = setTimeout(run, ms);
    timer.unref?.();
    return timer;
  }

  private due(person: string, id: string): void {
    const waiting = this.pending.get(id);
    if (!waiting) return;
    const left = this.deskLeft(person);
    if (left > 0) {
      // still at a desk: look again once that desk would count as left
      waiting.timer = this.schedule(person, id, left);
      return;
    }
    this.pending.delete(id);
    void this.deps.push(person, waiting.notification)
      .then((delivered) => { if (delivered > 0) this.onPhone.add(id); })
      .catch(() => {});
  }
}
