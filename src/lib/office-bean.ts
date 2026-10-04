// Office view (fork): the bean agents' rules — which headgear a bot wears and
// how it behaves for its status. Shared by the 3D scene and the panel portrait.

/** A chief (a team's PM, the hero) wears the headset: the one on the calls. */
export const CHIEF_HEADGEAR = "Koptelefoon";
/** Everyone else: a stable pick by id (until headgear can be chosen). */
export const HEADGEAR = ["Pet", "Antenne", "Muts", "Propellerpet", "Kattenoren", "Oren", "Zonnebril", "Kiemplant", "Hoge hoed", "Halo", "Feesthoed", "Strik", "Hoorns", "Kroon", "Pylon"];

export function headgearFor(botId: string, chief?: boolean): string {
  if (chief) return CHIEF_HEADGEAR;
  let hash = 0;
  for (const char of botId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return HEADGEAR[hash % HEADGEAR.length];
}

/** waiting on you beats working; nothing to do is idle */
export type BeanMood = "waiting" | "working" | "idle";
export function beanMood(look: { working?: boolean; waiting?: boolean } | undefined): BeanMood {
  if (look?.waiting) return "waiting";
  return look?.working ? "working" : "idle";
}

/** How each mood shows: idle freezes (no head motion, no blinking), working
 * moves its head and blinks, waiting looks surprised and turns to you. */
export const MOOD = {
  idle: { expression: "normal", moves: false, blinks: false },
  working: { expression: "normal", moves: true, blinks: true },
  waiting: { expression: "surprised", moves: true, blinks: true },
} as const satisfies Record<BeanMood, { expression: string; moves: boolean; blinks: boolean }>;

/** Working: a small quick typing bob (metres) and a nod at the screen (rad). */
export function workingMotion(time: number, phase: number): { bob: number; pitch: number } {
  return { bob: Math.abs(Math.sin(time * 9 + phase)) * 0.01, pitch: 0.18 + Math.sin(time * 2.2 + phase) * 0.08 };
}
/** Waiting on you: chin up a little, turned to you. */
export const WAITING_PITCH = -0.12;

/** A short blink every ~4 s, offset per bot so they don't blink in step. */
export function blinking(time: number, phase: number): boolean {
  return (time + phase * 3) % 4.2 < 0.12;
}
