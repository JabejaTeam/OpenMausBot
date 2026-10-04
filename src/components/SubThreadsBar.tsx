// One quiet line above a Chief's composer: each teammate it has work out
// with, as a coloured dot and a name (a click opens that thread), and on the
// right how many questions still wait on the person (a click jumps to the
// oldest). Finished work drops off the line.
import { openThread, useStore, type Bot, type Message, type Task } from "@/state/store";
import { cn } from "@/lib/cn";
import { isOpenRelay } from "./RelayCard";

type Status = "working" | "waiting" | "done";

const DOT: Record<Status, string> = {
  working: "bg-ink-tertiary animate-pulse",
  waiting: "bg-accent",
  done: "bg-ink-tertiary",
};

const TITLE: Record<Status, string> = {
  working: "bezig",
  waiting: "wacht op jou",
  done: "klaar",
};

function statusOf(task: Task, openQuestion: boolean): Status {
  if (task.activity === "waiting-on-you" || openQuestion) return "waiting";
  if (task.busy || task.activity === "working") return "working";
  return "done";
}

export function SubThreadsBar({ bot, messages, onJump }: { bot: Bot; messages: Message[]; onJump?: () => void }) {
  const { state, dispatch } = useStore();
  const open = messages.filter(isOpenRelay);
  const asking = new Set(open.map((m) => m.card!.relay!.threadId ?? m.card!.relay!.botId));
  const rows = state.bots
    .flatMap((owner) => (owner.tasks ?? [])
      .filter((task) => task.openedBy?.botId === bot.id)
      .map((task) => ({ owner, task, status: statusOf(task, asking.has(task.threadId) || asking.has(owner.id)) })))
    .filter((row) => row.status !== "done")
    .sort((a, b) => (b.task.updatedAt ?? 0) - (a.task.updatedAt ?? 0));
  if (!rows.length && !open.length) return null;
  const jump = () => {
    onJump?.();
    document.querySelector(`[data-relay-id="${open[0]!.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="pointer-events-auto mx-auto mb-1.5 flex w-full max-w-[840px] items-center gap-3.5 px-6 text-[12px] text-ink-tertiary">
      {rows.map(({ owner, task, status }) => (
        <button
          key={`${owner.id}:${task.threadId}`}
          type="button"
          onClick={() => openThread(dispatch, { botId: owner.id, threadId: task.threadId }, state)}
          title={`${owner.name}: ${TITLE[status]}`}
          className="flex items-center gap-1.5 transition-colors hover:text-ink-secondary"
        >
          <span className={cn("size-1.5 rounded-full", DOT[status])} aria-hidden="true" />
          {owner.name}
        </button>
      ))}
      {open.length > 0 && (
        <button type="button" onClick={jump}
          className="ml-auto rounded-full bg-accent/15 px-2.5 py-0.5 font-medium text-accent-text transition-transform active:scale-[0.97]">
          {open.length === 1 ? "1 vraag" : `${open.length} vragen`}
        </button>
      )}
    </div>
  );
}
