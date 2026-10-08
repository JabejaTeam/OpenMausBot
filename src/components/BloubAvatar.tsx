// A bot's drawn avatar: a React port of bloub's BloubBot.vue renderer
// (https://github.com/jeremy-prt/bloub, MIT), reduced to what an avatar needs —
// body, eyes as holes in a mask, and the state's dots, arcs and notification
// pastille. The engine (src/vendor/bloub) is a pure function of time, so a
// still avatar is one sample at a fixed instant and never runs a loop.
import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { NOTIF_BLUE } from "@/vendor/bloub/decor";
import { BotEngine, type BotFrame } from "@/vendor/bloub/engine";
import { EXPRESSION_BY_ID } from "@/vendor/bloub/expressions";
import { BLINK_DUR, BLINKS } from "@/vendor/bloub/face";
import { DEMI_VIEWBOX, RAYON } from "@/vendor/bloub/repere";
import { COLOR_BY_ID, SHAPE_BY_ID, mixHex } from "@/vendor/bloub/skins";
import { STATE_BY_ID, type StateId } from "@/vendor/bloub/states";
import { MAX_STEP_MS } from "@/lib/office-motion";
import type { BloubColorId, BloubExpressionId, BloubShapeId } from "../../shared/bloub-look";

/**
 * The instant a still avatar shows. bloub's own favicon is `sample(1)` of
 * idle: eyes open, a notification pastille past its pop, thinking's dots
 * mid-pulse.
 */
export const BLOUB_STILL_AT = 1;

/** An awake bloub draws at 20 fps: a blink (0.18 s) still gets its frames,
 * and every frame costs the page a style, layout and paint pass, so fewer is
 * the saving that counts. Never above the office's 30 fps budget. */
const FRAME_MS = Math.max(MAX_STEP_MS, 1000 / 20);

/** What shows through the eye holes. bloub uses the page colour; avatars sit
 * on many surfaces, so the eyes are white — except on a body so light that
 * white eyes all but vanish (crème, amber), which gets bloub's ink instead. */
const EYE_LIGHT = "#ffffff";
const EYE_DARK = "#0a0a0c";
/** White eyes need at least this contrast with the body (WCAG ratio). Kept
 * low on purpose: white eyes are bloub's look, dark ones only a rescue. */
const MIN_EYE_CONTRAST = 1.9;

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The eye colour for a body colour. */
export function eyesFor(ink: string): string {
  return 1.05 / (luminance(ink) + 0.05) >= MIN_EYE_CONTRAST ? EYE_LIGHT : EYE_DARK;
}

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

// Battery first: a live bloub SLEEPS. Its last frame stays on screen and
// nothing runs until something worth drawing happens:
//   - a blink (bloub's own schedule, shared clock; each bloub joins about
//     half of them, so they don't blink in unison);
//   - the mouse moving (the eyes turn, then the loop sleeps again);
//   - its state, shape or expression changing (the morph plays out);
//   - working: bloub's thinking dots, the only continuous animation.
// Every awake bloub shares ONE requestAnimationFrame at the 30 fps budget;
// between wakes there is no frame and no timer except the next blink's.
// Nothing wakes while the tab is hidden; blinks and gaze also rest while the
// window is not focused (nobody is looking at it).

/** Seconds on the shared bloub clock. bloub's blink schedule ends at 900 s,
 * so the clock wraps before that. */
const CLOCK_WRAP = 880;
const T0 = typeof performance !== "undefined" ? performance.now() : 0;
function clockNow(): number {
  return (((performance.now() - T0) / 1000) % CLOCK_WRAP) + BLOUB_STILL_AT;
}

/** Margin around a wake so its first and last frame are drawn. */
const WAKE_PAD = 0.05;
/** How long a pointer move keeps the eyes turning (bloub's LOOK_MORPH + a frame or two). */
const LOOK_WAKE = 0.35;
/** How long a state, shape or expression change plays out (bloub's slowest morph + the pastille pop). */
const MORPH_WAKE = 1.2;

/** The blink in progress at `t`, as its index in bloub's schedule, or -1. */
function blinkAt(t: number): number {
  for (let i = 0; i < BLINKS.length; i++) {
    const start = BLINKS[i]!;
    if (t < start - WAKE_PAD) return -1;
    if (t <= start + BLINK_DUR + WAKE_PAD) return i;
  }
  return -1;
}

function nextBlinkAfter(t: number): number | undefined {
  return BLINKS.find((start) => start - WAKE_PAD > t);
}

type Sleeper = {
  /** Whether this bloub has something to draw at `t`. */
  awake(t: number, focused: boolean): boolean;
  /** Reads the DOM (where it sits), before any bloub writes this frame. */
  measure(t: number): void;
  draw(t: number): void;
};
const sleepers = new Set<Sleeper>();
let raf = 0;
let timer = 0;
let lastDraw = 0;
let focused = true;

function frame(ms: number) {
  raf = 0;
  const t = clockNow();
  const due = !lastDraw || ms - lastDraw >= FRAME_MS - 1;
  const drawing: Sleeper[] = [];
  for (const sleeper of sleepers) if (sleeper.awake(t, focused)) drawing.push(sleeper);
  const awake = drawing.length > 0;
  if (due) {
    // all reads, then all writes: one layout per frame, not one per bloub
    for (const sleeper of drawing) sleeper.measure(t);
    for (const sleeper of drawing) sleeper.draw(t);
  }
  if (due) lastDraw = ms;
  if (!awake) return sleepUntilNextBlink(t);
  // wait out the rest of the frame budget off the vsync, so a 120 Hz screen
  // gets 30 callbacks a second, not 120 that mostly skip
  const wait = FRAME_MS - (ms - lastDraw);
  if (wait > 6) timer = window.setTimeout(() => { timer = 0; raf = requestAnimationFrame(frame); }, wait - 4);
  else raf = requestAnimationFrame(frame);
}

function sleepUntilNextBlink(t: number) {
  clearTimeout(timer);
  timer = 0;
  if (!sleepers.size || !focused) return;
  const next = nextBlinkAfter(t);
  if (next !== undefined) timer = window.setTimeout(wake, Math.max(0, (next - t) * 1000));
}

/** Run the loop now (a blink is due, the mouse moved, something changed). */
function wake() {
  clearTimeout(timer);
  timer = 0;
  if (raf || !sleepers.size || (typeof document !== "undefined" && document.hidden)) return;
  lastDraw = 0;
  raf = requestAnimationFrame(frame);
}

function rest() {
  cancelAnimationFrame(raf);
  raf = 0;
  clearTimeout(timer);
  timer = 0;
}

let watching = false;

/** The mouse, in client coordinates, while it is over the window; null for
 * touch (a lifted finger would leave every gaze stuck) and once it leaves. */
let pointer: { x: number; y: number } | null = null;
/** Clock time until which the eyes still turn toward (or away from) the mouse. */
let lookUntil = 0;
/** Bumped when anything may have moved on screen (scroll, resize): a bloub
 * re-reads where it sits only then, so following the mouse forces no layout. */
let placeEpoch = 0;
/** Smallest change of gaze worth a frame, in degrees: a few pixels of mouse
 * travel turn a 40 px bloub's eyes by less than a pixel. */
const LOOK_STEP = 1;

function subscribeSleeper(sleeper: Sleeper): () => void {
  if (!watching && typeof document !== "undefined" && typeof document.addEventListener === "function") {
    watching = true;
    focused = document.hasFocus?.() ?? true;
    document.addEventListener("visibilitychange", () => (document.hidden ? rest() : wake()));
    window.addEventListener("focus", () => { focused = true; wake(); });
    window.addEventListener("blur", () => { focused = false; });
    window.addEventListener("resize", () => { placeEpoch++; }, { passive: true });
    window.addEventListener("scroll", () => { placeEpoch++; }, { passive: true, capture: true });
    window.addEventListener("pointermove", (event) => {
      pointer = event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY };
      lookUntil = clockNow() + LOOK_WAKE;
      wake();
    }, { passive: true });
    document.documentElement.addEventListener("pointerleave", () => {
      pointer = null;
      lookUntil = clockNow() + RELEASE_TIME;
      wake();
    });
  }
  sleepers.add(sleeper);
  wake();
  return () => {
    sleepers.delete(sleeper);
    if (!sleepers.size) rest();
  };
}

/** A small stable hash: which blinks a bloub joins. */
function joinsBlink(seed: string, blink: number): boolean {
  let hash = 2166136261 ^ blink;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  return ((hash >>> 0) & 0xff) < 140;
}

/** Head turn toward the mouse, in degrees: bloub's own follow range (its
 * ui/gaze.ts YAW_MAX, PITCH_MAX, PITCH), straight ahead instead of turned to
 * its settings panel, and without the entrance spin. */
const FOLLOW_YAW = 16;
const FOLLOW_PITCH = 13;
const FOLLOW_LIFT = 10;
/** How long the head takes to return when the mouse leaves (bloub's TURN_TIME). */
const RELEASE_TIME = 1.1;

/** Where a bloub at `box` looks for the current mouse; null without one or
 * without a box to aim from (a zero box would make NaN, which the engine keeps). */
function followLook(box: DOMRect | undefined) {
  if (!pointer || !box || box.width === 0 || box.height === 0) return null;
  const clamp = (value: number) => Math.max(-1, Math.min(1, value));
  const nx = clamp((pointer.x - (box.left + box.width / 2)) / Math.max(1, window.innerWidth / 2));
  const ny = clamp((pointer.y - (box.top + box.height / 2)) / Math.max(1, window.innerHeight / 2));
  return { yaw: nx * FOLLOW_YAW, pitch: FOLLOW_LIFT - ny * FOLLOW_PITCH, mix: 1, spin: 0, wander: 0 };
}

/** Whether the element is on screen; true where IntersectionObserver is
 * missing, so nothing stays frozen for lack of it. */
function useOnScreen(ref: React.RefObject<Element | null>, enabled: boolean): boolean {
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const element = ref.current;
    if (!enabled || !element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => setOnScreen(entries.some((entry) => entry.isIntersecting)));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, enabled]);
  return onScreen;
}

/** A dot's SVG attributes: a circle, or a path drawn at its place. */
function dotAttrs(dot: BotFrame["dots"][number], ink: string): Record<string, string | number> {
  const fill = dot.color ?? (dot.depth === undefined ? ink : mixHex(eyesFor(ink), ink, dot.depth));
  return dot.d
    ? { fill, opacity: dot.opacity, d: dot.d, transform: `translate(${dot.x} ${dot.y}) rotate(${dot.rot ?? 0}) scale(${R})` }
    : { fill, opacity: dot.opacity, cx: dot.x, cy: dot.y, r: dot.r };
}

/** Which elements a frame needs. Frames with the same layout differ only in
 * attributes, and those are written straight to the DOM. */
function layoutOf(frame: BotFrame): string {
  return [frame.eyes.length, Boolean(frame.notch), Boolean(frame.notif), Boolean(frame.dotsBehind),
    frame.dots.map((dot) => (dot.d ? "p" : "c")).join(""), frame.arcs.map((arc) => arc.id).join(",")].join("|");
}

/** Writes a frame into an svg React drew with the same layout: a few
 * attributes instead of a React render of the whole avatar per frame. */
function paint(svg: SVGSVGElement, frame: BotFrame, ink: string, body: boolean) {
  const set = (el: Element | undefined, attrs: Record<string, string | number>) => {
    if (el) for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, String(value));
  };
  if (body) for (const el of svg.querySelectorAll("[data-b=body]")) el.setAttribute("d", frame.bodyPath);
  set(svg.querySelector("[data-b=alpha]") ?? undefined, { opacity: frame.bodyAlpha });
  const eyes = svg.querySelectorAll("[data-b=eye]");
  frame.eyes.forEach((eye, i) => set(eyes[i], { d: eye.d, transform: eye.matrix, opacity: eye.alpha }));
  if (frame.notch) set(svg.querySelector("[data-b=notch]") ?? undefined, { cx: frame.notch.x, cy: frame.notch.y, r: frame.notch.r });
  if (frame.notif) set(svg.querySelector("[data-b=notif]") ?? undefined, { cx: frame.notif.x, cy: frame.notif.y, r: frame.notif.r });
  const dots = svg.querySelectorAll("[data-b=dot]");
  frame.dots.forEach((dot, i) => set(dots[i], dotAttrs(dot, ink)));
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
  const svg = useRef<SVGSVGElement>(null);
  const onScreen = useOnScreen(svg, animated && !reduced);
  const live = animated && !reduced && onScreen;

  const radii = SHAPE_BY_ID.get(shape)?.radii ?? null;
  const face = EXPRESSION_BY_ID.get(expression) ?? null;
  const ink = COLOR_BY_ID.get(color)?.hex ?? "#0a0a0c";

  const still = useMemo(
    () => new BotEngine(R, state, radii, face).sample(BLOUB_STILL_AT),
    [state, radii, face],
  );

  // The latest look, read by the loop when it starts and by the setters below.
  const latest = useRef({ state, radii, face, ink });
  latest.current = { state, radii, face, ink };
  /** The last frame drawn (React's or painted), and the layout React drew. */
  const drawn = useRef<BotFrame | null>(null);
  const layout = useRef("");
  const run = useRef<{ engine: BotEngine; morphUntil: number } | null>(null);
  const [liveFrame, setLiveFrame] = useState<BotFrame | null>(null);

  useEffect(() => {
    if (!live) {
      run.current = null;
      drawn.current = null;
      setLiveFrame(null);
      return;
    }
    const { state: initial, radii: initialRadii, face: initialFace } = latest.current;
    const current = { engine: new BotEngine(R, initial, initialRadii, initialFace), morphUntil: clockNow() + MORPH_WAKE };
    run.current = current;
    let aiming = false;
    // where it sits, re-read only after a scroll or resize (placeEpoch)
    let box: { rect: DOMRect; epoch: number } | null = null;
    // the gaze last drawn, and until when its morph still moves the eyes
    let drawnLook: { yaw: number; pitch: number } | null = null;
    let settleUntil = 0;
    const following = (t: number) => t < lookUntil && STATE_BY_ID.get(latest.current.state)?.baseFace === true;
    const unsubscribe = subscribeSleeper({
      awake(t, isFocused) {
        if (latest.current.state === "thinking" || t < current.morphUntil) return true;
        if (!isFocused) return false;
        if (following(t)) {
          if (t < settleUntil || !box || box.epoch !== placeEpoch) return true;
          const look = followLook(box.rect);
          if (!look !== !drawnLook) return true;
          if (look && drawnLook && Math.abs(look.yaw - drawnLook.yaw) + Math.abs(look.pitch - drawnLook.pitch) >= LOOK_STEP) return true;
        }
        const blink = blinkAt(t);
        return blink >= 0 && joinsBlink(uid, blink);
      },
      measure(t) {
        if (following(t) && (!box || box.epoch !== placeEpoch) && svg.current) box = { rect: svg.current.getBoundingClientRect(), epoch: placeEpoch };
      },
      draw(t) {
        // the eyes follow the mouse on a resting face; elsewhere the gaze IS
        // the state's animation (thinking's dots, the orbit) and stays its own
        if (following(t)) {
          const look = followLook(box?.rect);
          const moved = look && (!drawnLook || Math.abs(look.yaw - drawnLook.yaw) + Math.abs(look.pitch - drawnLook.pitch) >= LOOK_STEP);
          if (look && moved) {
            current.engine.setLook(look, t);
            drawnLook = look;
            aiming = true;
            settleUntil = t + BotEngine.LOOK_MORPH;
          } else if (!look && aiming) {
            current.engine.setLook(null, t, RELEASE_TIME);
            drawnLook = null;
            aiming = false;
            settleUntil = t + RELEASE_TIME;
          }
        }
        const next = current.engine.sample(t);
        drawn.current = next;
        // same elements as on screen and no gradient arcs: write attributes;
        // otherwise React lays the new elements out
        // at rest the body only breathes, by a fraction of a pixel at avatar
        // size: keep its outline and redraw just the eyes
        const body = latest.current.state === "thinking" || t < current.morphUntil;
        if (svg.current && !next.arcs.length && layoutOf(next) === layout.current) paint(svg.current, next, latest.current.ink, body);
        else setLiveFrame(next);
      },
    });
    return () => {
      unsubscribe();
      run.current = null;
    };
  }, [live, uid]);

  // Changes while running morph from the current frame instead of jumping,
  // and keep the bloub awake until the morph has played out.
  const changed = (apply: (engine: BotEngine, t: number) => void) => {
    const current = run.current;
    if (!current) return;
    const t = clockNow();
    apply(current.engine, t);
    current.morphUntil = t + MORPH_WAKE;
    wake();
  };
  useEffect(() => changed((engine, t) => engine.setState(state, t)), [state]);
  useEffect(() => changed((engine, t) => engine.setShape(radii, t)), [radii]);
  useEffect(() => changed((engine, t) => engine.setExpression(face, t)), [face]);

  // a re-render for any other reason keeps the latest painted frame
  const frame = (live && (drawn.current ?? liveFrame)) || still;
  layout.current = layoutOf(frame);

  const dots = (key: string) =>
    frame.dots.map((dot, i) => {
      const props = dotAttrs(dot, ink);
      return "d" in props ? <path key={`${key}${i}`} data-b="dot" {...props} /> : <circle key={`${key}${i}`} data-b="dot" {...props} />;
    });

  return (
    <svg
      ref={svg}
      width={size}
      height={size}
      viewBox={`${-VB} ${-VB} ${VB * 2} ${VB * 2}`}
      className="block shrink-0"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <defs>
        {/* the eyes are holes in the body, so they clip at its outline on their own */}
        <mask id={maskId} maskUnits="userSpaceOnUse" x={-VB} y={-VB} width={VB * 2} height={VB * 2}>
          <path data-b="body" d={frame.bodyPath} fill="#fff" />
          {frame.eyes.map((eye, i) => (
            <path key={i} data-b="eye" d={eye.d} transform={eye.matrix} opacity={eye.alpha} fill="#000" />
          ))}
          {frame.notch && <circle data-b="notch" cx={frame.notch.x} cy={frame.notch.y} r={frame.notch.r} fill="#000" />}
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

      <g data-b="alpha" opacity={frame.bodyAlpha}>
        {/* an opaque base in the body's shape, so nothing drawn behind shows through the eyes */}
        <path data-b="body" d={frame.bodyPath} fill={eyesFor(ink)} />
        <g mask={`url(#${maskId})`}>
          <rect x={-VB} y={-VB} width={VB * 2} height={VB * 2} fill={ink} />
        </g>
      </g>

      {!frame.dotsBehind && <g>{dots("pf")}</g>}

      {frame.notif && <circle data-b="notif" cx={frame.notif.x} cy={frame.notif.y} r={frame.notif.r} fill={NOTIF_BLUE} />}

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
