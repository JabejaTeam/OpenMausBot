// A bot's drawn avatar: a React port of bloub's BloubBot.vue renderer
// (https://github.com/jeremy-prt/bloub, MIT), reduced to what an avatar needs —
// body, eyes as holes in a mask, and the state's dots, arcs and notification
// pastille. The engine (src/vendor/bloub) is a pure function of time, so a
// still avatar is one sample at a fixed instant and never runs a loop.
import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { NOTIF_BLUE } from "@/vendor/bloub/decor";
import { BotEngine, type BotFrame } from "@/vendor/bloub/engine";
import { EXPRESSION_BY_ID } from "@/vendor/bloub/expressions";
import { DEMI_VIEWBOX, RAYON } from "@/vendor/bloub/repere";
import { COLOR_BY_ID, SHAPE_BY_ID, mixHex } from "@/vendor/bloub/skins";
import type { StateId } from "@/vendor/bloub/states";
import { MAX_STEP_MS } from "@/lib/office-motion";
import type { BloubColorId, BloubExpressionId, BloubShapeId } from "../../shared/bloub-look";

/**
 * The instant a still avatar shows. bloub's own favicon is `sample(1)` of
 * idle: eyes open, a notification pastille past its pop, thinking's dots
 * mid-pulse.
 */
export const BLOUB_STILL_AT = 1;

/** One frame of the office's 30 fps budget (src/lib/office-motion). */
const FRAME_MS = MAX_STEP_MS;

/** What shows through the eye holes. bloub uses the page colour; avatars sit
 * on many surfaces, so the eyes are plain white like the pastille's notch. */
const PAPER = "#ffffff";

const R = RAYON;
const VB = DEMI_VIEWBOX;

const reducedMotionQuery = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");

function subscribeReducedMotion(onChange: () => void) {
  const query = reducedMotionQuery();
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

/** Followed at runtime, not read once: the OS setting can change while open. */
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => reducedMotionQuery()?.matches ?? false,
    () => false,
  );
}

export type BloubAvatarProps = {
  size: number;
  shape: BloubShapeId;
  expression: BloubExpressionId;
  color: BloubColorId;
  /** bloub's state; only `idle` wears the chosen expression. */
  state?: StateId;
  /** Run the animation. Off (the default) draws one frozen frame. */
  animated?: boolean;
  label?: string;
};

function BloubAvatarComponent({ size, shape, expression, color, state = "idle", animated = false, label }: BloubAvatarProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const maskId = `bloub-mask-${uid}`;
  const reduced = usePrefersReducedMotion();
  const live = animated && !reduced;

  const radii = SHAPE_BY_ID.get(shape)?.radii ?? null;
  const face = EXPRESSION_BY_ID.get(expression) ?? null;
  const ink = COLOR_BY_ID.get(color)?.hex ?? "#0a0a0c";

  const still = useMemo(
    () => new BotEngine(R, state, radii, face).sample(BLOUB_STILL_AT),
    [state, radii, face],
  );

  // The latest look, read by the loop when it starts and by the setters below.
  const latest = useRef({ state, radii, face });
  latest.current = { state, radii, face };
  const run = useRef<{ engine: BotEngine; clock: number } | null>(null);
  const [liveFrame, setLiveFrame] = useState<BotFrame | null>(null);

  useEffect(() => {
    if (!live) {
      run.current = null;
      setLiveFrame(null);
      return;
    }
    const { state: initial, radii: initialRadii, face: initialFace } = latest.current;
    const current = { engine: new BotEngine(R, initial, initialRadii, initialFace), clock: BLOUB_STILL_AT };
    run.current = current;
    let raf = 0;
    let last = 0;
    const tick = (ms: number) => {
      raf = requestAnimationFrame(tick);
      if (last && ms - last < FRAME_MS - 1) return;
      // bounded step: a frame after a long pause resumes, it does not jump
      current.clock += last ? Math.min((ms - last) / 1000, 0.1) : 0;
      last = ms;
      setLiveFrame(current.engine.sample(current.clock));
    };
    const start = () => {
      if (raf || document.hidden) return;
      last = 0;
      raf = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      run.current = null;
    };
  }, [live]);

  // Changes while running morph from the current frame instead of jumping.
  useEffect(() => {
    run.current?.engine.setState(state, run.current.clock);
  }, [state]);
  useEffect(() => {
    run.current?.engine.setShape(radii, run.current.clock);
  }, [radii]);
  useEffect(() => {
    run.current?.engine.setExpression(face, run.current.clock);
  }, [face]);

  const frame = (live && liveFrame) || still;

  const dotProps = (dot: BotFrame["dots"][number]) => {
    const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(PAPER, ink, dot.depth));
    return dot.d
      ? { fill, opacity: dot.opacity, d: dot.d, transform: `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})` }
      : { fill, opacity: dot.opacity, cx: dot.x, cy: dot.y, r: dot.r };
  };
  const dots = (key: string) =>
    frame.dots.map((dot, i) => {
      const props = dotProps(dot);
      return "d" in props ? <path key={`${key}${i}`} {...props} /> : <circle key={`${key}${i}`} {...props} />;
    });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      className="block shrink-0"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <defs>
        {/* the eyes are holes in the body, so they clip at its outline on their own */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch && <circle cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
        </mask>
        {frame.arcs.map((arc) => (
          <linearGradient
            key={arc.id}
            id={`${uid}-${arc.id}`}
            gradientUnits="userSpaceOnUse"
            x1={arc.grad.x1}
            y1={arc.grad.y1}
            x2={arc.grad.x2}
            y2={arc.grad.y2}
          >
            {arc.grad.stops.map((c, i) => (
              <stop key={i} offset={i / (arc.grad.stops.length - 1)} stopColor={c} />
            ))}
          </linearGradient>
        ))}
      </defs>

      {frame.arcs.length > 0 && (
        <g fill="none" strokeLinecap="round">
          {frame.arcs.map((arc) => (
            <path key={`b${arc.id}`} d={arc.back} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />
          ))}
        </g>
      )}

      {frame.dotsBehind && <g>{dots("pb")}</g>}

      <g opacity={frame.bodyAlpha}>
        {/* an opaque base in the body's shape, so nothing drawn behind shows through the eyes */}
        <path d={frame.bodyPath} fill={PAPER} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>

      {!frame.dotsBehind && <g>{dots("pf")}</g>}

      {frame.notif && <circle cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />}

      {frame.arcs.length > 0 && (
        <g fill="none" strokeLinecap="round">
          {frame.arcs.map((arc) => (
            <path key={`f${arc.id}`} d={arc.front} stroke={`url(#${uid}-${arc.id})`} strokeWidth={arc.width} opacity={arc.opacity} />
          ))}
        </g>
      )}
    </svg>
  );
}

export const BloubAvatar = memo(BloubAvatarComponent);
