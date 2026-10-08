// Fork: a bot's avatar everywhere in the app is its office bean — the same
// colour, headgear and mood the 3D office shows (bean-looks is the source).
import type { MausColor } from "@/lib/mascot";
import { MAUS_COLORS } from "@/lib/mascot";
import { beanMood, headgearFor } from "@/lib/office-bean";
import { useTeamLooks } from "@/lib/use-team-looks";
import { useOptionalStore } from "@/state/store";
import { beanLooksFor } from "./bean-looks";
import { BeanPortrait } from "./BeanPortrait";

export function BeanBotAvatar({ bot, size, still, label }: {
  bot: { id?: string; name?: string; color: MausColor };
  size: number;
  /** no motion (small chips, previews) */
  still?: boolean;
  label?: string;
}) {
  const store = useOptionalStore();
  const { looks: teamLooks } = useTeamLooks();
  const look = store && bot.id ? beanLooksFor(store.state, teamLooks).get(bot.id) : undefined;
  return (
    <BeanPortrait
      color={look?.color ?? MAUS_COLORS[bot.color] ?? MAUS_COLORS.blue}
      headgear={headgearFor(bot.id ?? bot.name ?? "", look?.chief)}
      mood={still ? "idle" : beanMood(look)}
      size={size}
      label={label}
    />
  );
}
