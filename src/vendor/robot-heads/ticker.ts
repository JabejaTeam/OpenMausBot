/* One shared animation loop for every head on the page. Each subscriber
   gets the seconds since its last frame; the loop sleeps while the tab is
   hidden, while the window is not the active one (fork: the heads stand
   still behind other windows, in a browser and in the desktop app alike),
   or while nobody is listening.
   fork: driven by a timer, not a requestAnimationFrame that re-arms every
   display frame — on a 120 Hz screen that spin wakes the page 120×/s even
   when it draws 30, and every requested frame runs the browser's whole
   frame pipeline even when nothing is drawn. The timer wakes only when some
   head is due and draws straight away; a frame is produced only when a
   canvas actually changed. Each head has its own rate (games' update-rate
   LOD): small heads tick slower than big ones. */

type Tick = (dt: number) => void;

/** Where the pointer last was on the page, NaN while it is away. */
export const pointer = { x: NaN, y: NaN };

/** fork: bumped on every scroll or resize, so a head re-measures its box
 * only then — never a layout read per frame. */
export const layout = { epoch: 0 };

interface Sub {
  fn: Tick;
  interval: number;
  due: number;
  last: number;
}

const subscribers = new Set<Sub>();
let timer: ReturnType<typeof setTimeout> | 0 = 0;
let listening = false;

/* the next tick on a grid shared by every head with this interval, so heads
   draw in the same wake-up and the browser composites one frame, not one
   per head */
const slot = (after: number, interval: number) => Math.ceil(after / interval) * interval;

function run() {
  const now = performance.now();
  for (const s of subscribers) {
    /* 2 ms early still counts: timers and frames never land exactly */
    if (now < s.due - 2) continue;
    const dt = s.last ? Math.min(0.1, (now - s.last) / 1000) : 0;
    s.last = now;
    s.due = slot(now + s.interval * 0.5, s.interval);
    s.fn(dt);
  }
  schedule();
}

/** fork: the heads move only in the window you are using. */
const active = () => !document.hidden && document.hasFocus();

function schedule() {
  if (timer || typeof document === 'undefined' || !active() || !subscribers.size) return;
  let next = Infinity;
  for (const s of subscribers) next = Math.min(next, s.due);
  const wait = Math.max(0, next - performance.now() - 4);
  timer = setTimeout(() => {
    timer = 0;
    run();
  }, wait);
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = 0;
}

function listen() {
  if (listening || typeof document === 'undefined') return;
  listening = true;
  const away = () => {
    pointer.x = NaN;
    pointer.y = NaN;
  };
  document.addEventListener('pointermove', (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
  }, { passive: true });
  document.addEventListener('pointerleave', away);
  const moved = () => {
    layout.epoch++;
  };
  window.addEventListener('scroll', moved, { passive: true, capture: true });
  window.addEventListener('resize', moved, { passive: true });
  const wake = () => {
    if (!active()) return stop();
    /* a long sleep is not one huge step */
    for (const s of subscribers) s.last = 0;
    schedule();
  };
  window.addEventListener('blur', () => {
    away();
    stop();
  });
  window.addEventListener('focus', wake);
  document.addEventListener('visibilitychange', wake);
}

/** Call `fn` about every `interval` ms until unsubscribed. */
export function subscribe(fn: Tick, interval: number): () => void {
  listen();
  const sub: Sub = { fn, interval, due: slot(performance.now(), interval), last: 0 };
  subscribers.add(sub);
  schedule();
  return () => {
    subscribers.delete(sub);
    if (!subscribers.size) stop();
  };
}
