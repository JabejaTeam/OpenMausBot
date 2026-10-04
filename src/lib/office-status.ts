// Office view (fork): one status per bot, so the 3D markers, the status rail
// and the thread a click opens always agree. Waiting on you beats working
// beats unread; routine runs never count.
import { latestThreadId } from "./office-layout";

export type OfficeStatus = "waiting" | "working" | "unread" | "idle";

type Activity = "working" | "waiting-on-you" | "idle" | "no-signal" | "dead" | undefined;

interface StatusTask {
  threadId: string;
  title?: string;
  routineRunId?: string;
  createdAt: number;
  updatedAt?: number;
  activity?: Activity;
  busy?: boolean;
  unread?: boolean;
}

export interface StatusBot {
  id: string;
  threadId: string;
  activity?: Activity;
  busy?: boolean;
  unread?: boolean;
  tasks?: StatusTask[];
}

const conversations = (bot: StatusBot) => (bot.tasks ?? []).filter((task) => !task.routineRunId);
const newest = (tasks: StatusTask[]) =>
  [...tasks].sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))[0];

const waitingTasks = (bot: StatusBot) => conversations(bot).filter((task) => task.activity === "waiting-on-you");
const workingTasks = (bot: StatusBot) => conversations(bot).filter((task) => task.busy || task.activity === "working");
const unreadTasks = (bot: StatusBot) => conversations(bot).filter((task) => task.unread);

export function botStatus(bot: StatusBot): OfficeStatus {
  if (bot.activity === "waiting-on-you" || waitingTasks(bot).length) return "waiting";
  if (bot.busy || bot.activity === "working" || workingTasks(bot).length) return "working";
  if (bot.unread || unreadTasks(bot).length) return "unread";
  return "idle";
}

/** The thread a click opens, in status order: the one waiting on you, else
 * the one being worked on, else the newest unread one, else the newest
 * conversation. The header's "working on …" names this same thread. */
export function attentionThreadId(bot: StatusBot): string {
  if (bot.activity === "waiting-on-you" && !waitingTasks(bot).length) return bot.threadId;
  if (waitingTasks(bot).length) return newest(waitingTasks(bot)).threadId;
  if ((bot.busy || bot.activity === "working") && !workingTasks(bot).length) return bot.threadId;
  return newest(workingTasks(bot))?.threadId ?? newest(unreadTasks(bot))?.threadId ?? latestThreadId(bot);
}

/** Bots per status that needs a look, in the given (team) order. */
export function statusGroups<B extends StatusBot>(bots: B[]): Record<Exclude<OfficeStatus, "idle">, B[]> {
  const groups: Record<Exclude<OfficeStatus, "idle">, B[]> = { waiting: [], working: [], unread: [] };
  for (const bot of bots) {
    const status = botStatus(bot);
    if (status !== "idle") groups[status].push(bot);
  }
  return groups;
}

/** What the bot is on, for the panel header: the thread a click opens and
 * the status that thread is in. No title when it is the idle current one. */
export function focusTask(bot: StatusBot): { status: OfficeStatus; title: string | null } {
  const status = botStatus(bot);
  if (status === "idle") return { status, title: null };
  const threadId = attentionThreadId(bot);
  const task = (bot.tasks ?? []).find((item) => item.threadId === threadId);
  return { status, title: task?.title?.trim() || null };
}

/** The next bot that needs you — waiting on you first, then unread — after
 * `currentId` in that order, wrapping round; null when nobody else does. */
export function nextNeedingYou<B extends StatusBot>(bots: B[], currentId: string | null): { bot: B; count: number } | null {
  const groups = statusGroups(bots);
  const queue = [...groups.waiting, ...groups.unread];
  const others = queue.filter((bot) => bot.id !== currentId);
  if (!others.length) return null;
  const at = queue.findIndex((bot) => bot.id === currentId);
  const next = at < 0 ? queue[0] : (queue.slice(at + 1).find((bot) => bot.id !== currentId) ?? others[0]);
  return { bot: next, count: others.length };
}
