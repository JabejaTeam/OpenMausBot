// Simple UI (fork): BotAvatar in a soft body instead of the default cursor.
import type { MascotBodyId } from "../../shared/mascot-bodies";
import { simpleMascotBody } from "@/lib/simple-ui-groups";
import { BotAvatar, type BotAvatarProps } from "./Avatar";

export function SimpleBotAvatar({ bot, ...props }: BotAvatarProps & { bot: BotAvatarProps["bot"] & { id?: string } }) {
  return <BotAvatar bot={{ ...bot, mascotBody: simpleMascotBody(bot) as MascotBodyId }} {...props} />;
}
