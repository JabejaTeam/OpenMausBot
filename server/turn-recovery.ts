// A conversation turn that a server restart cut off is picked up again on
// boot. The set of running turns is written whenever it changes, so a crash
// leaves it behind just like a clean stop. A thread is picked up at most
// `limit` times in a row: a turn that keeps dying with the server stops
// being replayed.
import { readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const entrySchema = z.object({
  botId: z.string(), threadId: z.string(),
  /** how many restarts in a row already picked this turn up */
  recoveries: z.number().int().nonnegative().default(0),
});
export type RunningTurn = z.infer<typeof entrySchema>;

export class TurnRecovery {
  /** What was running when the previous server stopped, within the limit. */
  readonly interrupted: RunningTurn[];
  private readonly recoveries = new Map<string, number>();
  private running = new Set<string>();
  private written = "";
  private readonly file: string;

  constructor(file: string, limit = 2) {
    this.file = file;
    let saved: RunningTurn[] = [];
    try { saved = z.array(entrySchema).max(1000).parse(JSON.parse(readFileSync(file, "utf8"))); }
    catch { /* missing or unreadable: nothing to pick up */ }
    this.interrupted = saved.filter(turn => turn.recoveries < limit);
  }

  /** Marks a pick-up, so a restart during it counts against the limit. */
  recovering(turn: RunningTurn) { this.recoveries.set(turn.threadId, turn.recoveries + 1); }

  /** The threads with a turn in flight now. A pick-up ends with its turn. */
  sync(working: Array<{ botId: string; threadId: string }>) {
    const now = new Set(working.map(turn => turn.threadId));
    for (const threadId of this.running) if (!now.has(threadId)) this.recoveries.delete(threadId);
    this.running = now;
    const text = JSON.stringify(working.map(turn => ({ ...turn, recoveries: this.recoveries.get(turn.threadId) ?? 0 })));
    if (text === this.written) return;
    writeFileAtomic(this.file, text, { mode: 0o600 });
    this.written = text;
  }
}
