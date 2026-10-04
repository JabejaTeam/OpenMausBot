// Office view (fork): which bot is working for which, drawn as arcs between
// their desks. A thread a bot opened on a teammate (delegate_bot, start_thread,
// a coordinated handoff) carries `openedBy`; while that thread is at work the
// link holds, and a link that just appeared is a handoff happening now.

export const RECENT_HANDOFF_MS = 6000;

interface LinkTask {
  threadId: string;
  routineRunId?: string;
  busy?: boolean;
  activity?: string;
  openedBy?: { botId: string; at: number };
}

export interface LinkBot {
  id: string;
  tasks?: LinkTask[];
}

export interface DelegationLink {
  /** stable per pair: "from>to" */
  id: string;
  from: string;
  to: string;
  /** the newest handoff between the two (epoch ms) */
  at: number;
  /** the work is still going (or waits on you) */
  active: boolean;
}

const atWork = (task: LinkTask) => Boolean(task.busy) || task.activity === "working" || task.activity === "waiting-on-you";

/** One link per pair of office bots: active ones, and ones handed off in the
 * last RECENT_HANDOFF_MS even if already done (a quick handoff still shows). */
export function delegationLinks(bots: LinkBot[], now: number): DelegationLink[] {
  const office = new Set(bots.map((bot) => bot.id));
  const links = new Map<string, DelegationLink>();
  for (const bot of bots) {
    for (const task of bot.tasks ?? []) {
      const opener = task.openedBy;
      if (!opener || task.routineRunId || opener.botId === bot.id || !office.has(opener.botId)) continue;
      const active = atWork(task);
      if (!active && now - opener.at > RECENT_HANDOFF_MS) continue;
      const id = `${opener.botId}>${bot.id}`;
      const known = links.get(id);
      links.set(id, {
        id,
        from: opener.botId,
        to: bot.id,
        at: Math.max(known?.at ?? 0, opener.at),
        active: Boolean(known?.active) || active,
      });
    }
  }
  return [...links.values()];
}

/** The links a bot takes part in, for highlighting on hover or selection. */
export function linksOf(links: DelegationLink[], botId: string | null): Set<string> {
  return new Set(botId ? links.filter((link) => link.from === botId || link.to === botId).map((link) => link.id) : []);
}
