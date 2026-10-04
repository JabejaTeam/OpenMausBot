// Above a Chief's composer, only when questions wait on the person: how many,
// on the right (a click jumps to the oldest). Teammates at work are not
// listed here — the header and the office already show who is busy.
import type { Bot, Message } from "@/state/store";
import { isOpenRelay } from "./RelayCard";

export function SubThreadsBar({ messages, onJump }: { bot: Bot; messages: Message[]; onJump?: () => void }) {
  const open = messages.filter(isOpenRelay);
  if (!open.length) return null;
  const jump = () => {
    onJump?.();
    document.querySelector(`[data-relay-id="${open[0]!.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="pointer-events-auto mx-auto mb-1.5 flex w-full max-w-[840px] items-center px-6 text-[12px]">
      <button type="button" onClick={jump}
        className="ml-auto rounded-full bg-accent/15 px-2.5 py-0.5 font-medium text-accent-text transition-transform active:scale-[0.97]">
        {open.length === 1 ? "1 vraag" : `${open.length} vragen`}
      </button>
    </div>
  );
}
