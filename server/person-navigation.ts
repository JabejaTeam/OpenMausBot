// Fork: where each person was last, per agent — the conversation they had
// open and when. One record for every device of that person, so opening a
// client lands on the agent you last used in it, in the chat you last read.
// A bot's own `threadId` is one value for the whole workspace and moves with
// whoever switched last; this is the per-person answer.
// One small server-private file (<data>/person-navigation.json, 0600).
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";

export interface Visit {
  threadId: string;
  at: number;
}

const ID = /^[\w-]{1,128}$/;
const KEY = /^[\w-]{1,128}$/;
/** Visits kept per person: the agents they actually move between. */
export const MAX_VISITS_PER_PERSON = 500;
/** Selecting an agent can come in bursts; the file is written once they settle. */
const WRITE_DELAY_MS = 2_000;

export class PersonNavigation {
  private readonly people = new Map<string, Map<string, Visit>>();
  private readonly file: string;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(file: string) {
    this.file = file;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return; // absent or unreadable: nobody has been anywhere yet
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    for (const [person, visits] of Object.entries(raw)) {
      if (!KEY.test(person) || !visits || typeof visits !== "object" || Array.isArray(visits)) continue;
      const kept = new Map<string, Visit>();
      for (const [botId, visit] of Object.entries(visits)) {
        const { threadId, at } = (visit ?? {}) as Partial<Visit>;
        if (ID.test(botId) && typeof threadId === "string" && ID.test(threadId) && typeof at === "number" && Number.isFinite(at)) {
          kept.set(botId, { threadId, at });
        }
      }
      if (kept.size) this.people.set(person, kept);
    }
  }

  /** Every agent this person visited: its last conversation and when. */
  visits(person: string): Record<string, Visit> {
    return Object.fromEntries(this.people.get(person) ?? []);
  }

  /** The conversation this person last had open with this agent. */
  lastThread(person: string, botId: string): string | undefined {
    return this.people.get(person)?.get(botId)?.threadId;
  }

  /** Remember that this person is on this agent, in this conversation.
   * False for an invalid id. */
  remember(person: string, botId: string, threadId: string, at = Date.now()): boolean {
    if (!KEY.test(person) || !ID.test(botId) || !ID.test(threadId)) return false;
    let visits = this.people.get(person);
    if (!visits) this.people.set(person, (visits = new Map()));
    visits.delete(botId);
    visits.set(botId, { threadId, at });
    // the oldest visits go first (a Map keeps insertion order)
    while (visits.size > MAX_VISITS_PER_PERSON) visits.delete(visits.keys().next().value!);
    this.scheduleWrite();
    return true;
  }

  /** Write now (shutdown, tests). */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const out: Record<string, Record<string, Visit>> = {};
    for (const [person, visits] of this.people) out[person] = Object.fromEntries(visits);
    writeFileAtomic(this.file, JSON.stringify(out) + "\n", { mode: 0o600 });
  }

  private scheduleWrite(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), WRITE_DELAY_MS);
    this.timer.unref?.();
  }
}
