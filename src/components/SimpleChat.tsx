// Simple UI (fork): the chat pieces that replace the full header and the
// bot⇄bot chips — a floating name pill on top, and a centered
// "Messaged ◉ Name" / "Message from ◉ Name" line in the transcript.
import type { CSSProperties, ReactNode } from "react";
import { useStore, type Bot, type MausColor } from "@/state/store";
import { t } from "@/lib/i18n";
import { stateForBot } from "@/lib/mascot";
import { SimpleBotAvatar as BotAvatar } from "./SimpleBotAvatar";

export function SimpleHeaderPill({
  avatar,
  name,
  title,
  onClick,
  dragStyle,
  noDragStyle,
}: {
  avatar: ReactNode;
  name: string;
  title?: string;
  onClick: () => void;
  dragStyle?: CSSProperties;
  noDragStyle?: CSSProperties;
}) {
  return (
    <div style={dragStyle} className="flex justify-center px-5 pb-1 pt-3" data-simple-header>
      <button
        type="button"
        onClick={onClick}
        title={title}
        style={noDragStyle}
        className="flex max-w-[70%] items-center gap-2 rounded-full bg-raised/90 py-1.5 pl-2 pr-4 shadow-lg shadow-black/30 backdrop-blur hover:bg-raised"
      >
        {avatar}
        <span className="truncate text-[15px] font-medium text-ink">{name}</span>
      </button>
    </div>
  );
}

export function SimpleChatHeader({ bot, dragStyle, noDragStyle }: { bot: Bot; dragStyle?: CSSProperties; noDragStyle?: CSSProperties }) {
  const { dispatch } = useStore();
  return (
    <SimpleHeaderPill
      avatar={<BotAvatar bot={bot} state={stateForBot(bot)} size={24} />}
      name={bot.name}
      title={t("chat.openProfile")}
      onClick={() => dispatch({ type: "toggleSettings", open: true })}
      dragStyle={dragStyle}
      noDragStyle={noDragStyle}
    />
  );
}

/** Which way a comm chip points, read from the server's chip text
 * ("Messaged @X" / "Sent to X" vs "Message from @X" / "X replied");
 * null for anything else (e.g. "Posted in Room"), which keeps its own text. */
export function commDirection(chipName: string, withName: string): "to" | "from" | null {
  if (chipName.startsWith("Messaged ") || chipName.startsWith("Sent to ")) return "to";
  if (chipName.startsWith("Message from ") || chipName.startsWith(`${withName} replied`)) return "from";
  return null;
}

/** "Messaged ◉ Ripal code" (outgoing) or "Message from ◉ Ripal code"
 * (incoming), centered; clicking opens the bot⇄bot channel when known. */
export function SimpleCommLine({
  direction,
  bot,
  name,
  color,
  onOpen,
}: {
  direction: "to" | "from";
  bot?: Bot;
  name: string;
  color?: MausColor;
  onOpen?: () => void;
}) {
  const body = (
    <>
      <span>{direction === "to" ? t("simpleUi.messaged") : t("simpleUi.messageFrom")}</span>
      <BotAvatar bot={bot ?? { name, color: color ?? "blue" }} state="happy" size={18} motion="none" motionKey={0} animated={false} />
      <span className="font-medium text-ink/80">{name}</span>
    </>
  );
  return (
    <div className="flex justify-center py-1.5" data-simple-comm={direction}>
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          title={t("chat.openConversationWith", { name })}
          className="flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[13.5px] text-ink-secondary hover:text-ink"
        >
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-0.5 text-[13.5px] text-ink-secondary">{body}</div>
      )}
    </div>
  );
}
