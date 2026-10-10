// A bot's avatar as a robot-heads TV head (https://github.com/fayazara/robot-heads,
// MIT, vendored in src/vendor/robot-heads). Preview beside BloubAvatar.
// Every bot is the classic TV head; only the colour comes from its bloub look.
//
// Battery first, every head still alive: the vendored renderer only paints
// when a change is visible at the head's size, moves small heads as a baked
// picture (full 3D only under the pointer), ticks them at 15–30 fps on one
// shared timer, and a head out of view stops.
import { memo, useState } from "react";

import { RobotHead } from "@/vendor/robot-heads/RobotHead";
import type { RobotHeadState } from "@/vendor/robot-heads/types";
import { COLOR_BY_ID } from "@/vendor/bloub/skins";
import type { MausState } from "@/lib/mascot";
import type { BloubColorId } from "../../shared/bloub-look";

/** The app's state for a bot -> the head's face. Busy wins; waiting on you
 * listens; a failed tool shows the error face. */
export function robotStateFor(state: MausState | undefined, busy: boolean): RobotHeadState {
  if (busy) return "working";
  if (state === "notifying") return "listening";
  if (state === "alerting") return "error";
  if (state === "sleeping") return "sleeping";
  return "idle";
}

function seedFor(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

export const RobotHeadAvatar = memo(function RobotHeadAvatar({
  id,
  size,
  color,
  state,
  label,
}: {
  id: string;
  size: number;
  color: BloubColorId;
  state: RobotHeadState;
  label?: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      className="inline-flex shrink-0"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <RobotHead
        size={size}
        state={state}
        color={COLOR_BY_ID.get(color)?.hex ?? "#3b93f0"}
        antenna={size >= 64}
        floorShadow={size >= 64}
        interactive={hovered}
        seed={seedFor(id)}
        aria-label={label}
      />
    </span>
  );
});
