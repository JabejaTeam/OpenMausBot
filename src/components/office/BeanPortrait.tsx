import { useEffect, useRef } from "react";
import { blinking, MOOD, WAITING_PITCH, workingMotion, type BeanMood } from "@/lib/office-bean";
import { FrameCap } from "@/lib/frame-budget";

// Office view (fork): the bot's avatar as its bean — a head-and-shoulders
// portrait with its colour and headgear (bean/portrait.js draws it). It moves
// only when the bot does: working nods, waiting tilts its head, idle is still.
export function BeanPortrait({ color, headgear, mood, size }: { color: string; headgear: string; mood: BeanMood; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let frame = 0;
    let stopped = false;
    // a moving portrait draws within the app's frame budget (lib/frame-budget)
    const cap = new FrameCap();
    const still = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // @ts-expect-error plain JS module (preview)
    void import("./bean/portrait.js").then(async ({ portraitStudio }) => {
      const studio = await portraitStudio();
      const draw = (now: number) => {
        if (stopped || !ref.current) return;
        if (!cap.ready(now)) {
          frame = requestAnimationFrame(draw);
          return;
        }
        const time = MOOD[mood].moves ? now / 1000 : 0;
        // the same moods as at the desk: working nods, waiting looks up at you, idle holds still
        const pitch = mood === "working" ? workingMotion(time, 0).pitch : mood === "waiting" ? WAITING_PITCH : 0;
        studio.draw(ref.current, { color, headgear, expression: MOOD[mood].expression, blink: MOOD[mood].blinks && blinking(time, 0), pitch, time });
        if (MOOD[mood].moves && !still) frame = requestAnimationFrame(draw);
      };
      draw(performance.now());
    });
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
    };
  }, [color, headgear, mood]);
  const pixels = Math.round(size * Math.min(globalThis.devicePixelRatio ?? 1, 2));
  return <canvas ref={ref} width={pixels} height={pixels} style={{ width: size, height: size }} className="shrink-0 rounded-full bg-raised" aria-hidden />;
}
