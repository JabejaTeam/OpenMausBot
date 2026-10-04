// A teammate's question, handed on by a Chief: either one the Chief passed
// on (relay_question, answered back to the Chief as a chat line) or a card
// the teammate's own turn stopped on (answered directly in its thread).
//
// Drawn like any message from that teammate: its name over a plain bubble,
// one-tap answers as tinted capsules underneath, a reply field on demand and
// the rarer actions behind "⋯". Once settled it folds into one quiet system
// line, the way a chat app notes what happened.
import { useState } from "react";
import { Check, CornerDownLeft, MoreHorizontal } from "lucide-react";
import { openThread, useStore, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { relayAnswerText, relayDelegateText } from "../../shared/relay-question";
import { BotAvatar } from "./Avatar";
import { BotName } from "./SimpleChat";

/** Still waiting on the person: neither answered nor put aside. */
export function isOpenRelay(message: Message): boolean {
  return message.kind === "options" && !!message.card?.relay && !message.card.answered && !message.card.dismissed;
}

/** A quiet centred system line about a teammate, read as Dutch puts it:
 * "BOA PM (icon) gestuurd". A click opens that teammate's thread. */
export function AgentTag({ label, botId, threadId }: { label: string; botId: string; threadId?: string }) {
  const { state, dispatch } = useStore();
  const bot = state.bots.find((candidate) => candidate.id === botId);
  return (
    <div className="flex justify-center py-0.5">
      <button
        type="button"
        disabled={!threadId}
        onClick={() => threadId && openThread(dispatch, { botId, threadId }, state)}
        className="flex items-center gap-1.5 text-[12px] text-ink-tertiary transition-colors enabled:hover:text-ink-secondary"
      >
        <span className="font-medium"><BotName bot={bot} fallback="Teammate" /></span>
        {bot && <BotAvatar bot={bot} state="happy" size={18} motion="none" motionKey={0} animated={false} />}
        {label}
      </button>
    </div>
  );
}

const capsule =
  "rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-transform duration-150 active:scale-[0.97]";
const iconButton =
  "flex size-7 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-control hover:text-ink";

export function RelayCard({ botId, threadId, message }: { botId: string; threadId?: string; message: Message }) {
  const { state, dispatch } = useStore();
  const [replying, setReplying] = useState(false);
  const [more, setMore] = useState(false);
  const [custom, setCustom] = useState("");
  const card = message.card;
  const relay = card?.relay;
  if (!card || !relay) return null;
  const asker = state.bots.find((candidate) => candidate.id === relay.botId);

  if (!isOpenRelay(message)) {
    return (
      <div data-relay-id={message.id} className="flex justify-center py-0.5">
        <span className="flex items-center gap-1 text-[11.5px] text-ink-tertiary">
          <Check size={11} strokeWidth={2.25} />
          <span className="font-medium"><BotName bot={asker} fallback={relay.name} /></span>
          <span className="max-w-[420px] truncate">· {card.answered ?? "afgevinkt"}</span>
        </span>
      </div>
    );
  }

  const settle = (answered: string, text?: string) => {
    dispatch({ type: "settleRelay", botId, threadId, messageId: message.id, answered });
    if (text) dispatch({ type: "send", botId, threadId, text });
  };
  // A card the teammate's own turn is stopped on is answered directly, in
  // its thread; the Chief needs no extra turn for that.
  const direct = relay.requestId && relay.threadId ? { requestId: relay.requestId, threadId: relay.threadId } : null;
  const answer = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (direct) {
      dispatch({
        type: "decideRequest",
        ...direct,
        behavior: relay.permission ? (trimmed === "Weigeren" ? "deny" : "allow") : "answer",
        ...(relay.permission ? {} : { message: trimmed }),
      });
      dispatch({ type: "settleRelay", botId, threadId, messageId: message.id, answered: trimmed });
    } else settle(trimmed, relayAnswerText(relay, card.subtitle, trimmed));
    setCustom("");
  };
  const chief = state.bots.find((candidate) => candidate.id === botId)?.name ?? "de Chief";
  const leaveIt = () => direct
    ? answer("Wiebren laat de keuze aan jou: kies zelf de beste optie en vermeld je keuze in je rapport.")
    : settle(`Overgelaten aan ${chief}`, relayDelegateText(relay, card.subtitle));
  const menuItem = "rounded-full px-3 py-1 text-[12.5px] text-ink-secondary transition-colors hover:bg-control hover:text-ink";

  return (
    <div data-relay-id={message.id} className="animate-msg-in flex w-full flex-col items-start">
      <button
        type="button"
        disabled={!relay.threadId}
        onClick={() => relay.threadId && openThread(dispatch, { botId: relay.botId, threadId: relay.threadId }, state)}
        className="mb-1 flex items-center gap-1.5 pl-0.5 text-[11px] font-medium text-ink-secondary enabled:hover:text-ink"
      >
        {asker && <BotAvatar bot={asker} state="happy" size={16} motion="none" motionKey={0} animated={false} />}
        <BotName bot={asker} fallback={relay.name} />
        <span className="size-1.5 rounded-full bg-accent" aria-label="wacht op je antwoord" />
      </button>
      <div className="w-fit max-w-[min(42rem,78%)] rounded-2xl bg-card px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap text-ink">
        {card.subtitle}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {card.options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => answer(option)}
            className={cn(capsule, "bg-accent/15 text-accent-text hover:bg-accent/25")}
          >
            {option}
          </button>
        ))}
        {!relay.permission && (
          <button type="button" title="Antwoorden" aria-label="Antwoorden" onClick={() => setReplying((value) => !value)} className={iconButton}>
            <CornerDownLeft size={14} />
          </button>
        )}
        <button type="button" title="Meer" aria-label="Meer" onClick={() => setMore((value) => !value)} className={iconButton}>
          <MoreHorizontal size={15} />
        </button>
      </div>
      {replying && (
        <input
          autoFocus
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") answer(custom);
            if (event.key === "Escape") setReplying(false);
          }}
          placeholder={`Antwoord aan ${relay.name}`}
          className="mt-2 w-full max-w-[min(42rem,78%)] rounded-full bg-raised px-4 py-2 text-[14px] text-ink placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-accent/40"
        />
      )}
      {more && (
        <div className="mt-1.5 flex flex-wrap gap-0.5">
          {!relay.permission && (
            <button type="button" onClick={leaveIt} className={menuItem}>
              {direct ? `Laat ${relay.name} kiezen` : `Laat ${chief} beslissen`}
            </button>
          )}
          <button type="button" className={menuItem}
            onClick={() => dispatch({ type: "settleRelay", botId, threadId, messageId: message.id, dismissed: true })}>
            Afvinken
          </button>
          {relay.threadId && (
            <button type="button" className={menuItem}
              onClick={() => openThread(dispatch, { botId: relay.botId, threadId: relay.threadId! }, state)}>
              Open thread
            </button>
          )}
        </div>
      )}
    </div>
  );
}
