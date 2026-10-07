// Fork: the app's frame budget. Everything that moves by itself — the office's
// 3D loop, a bean portrait, the mascot, a spinner — draws at most MAX_FPS
// frames a second, whatever the display's refresh rate. On a 120 Hz ProMotion
// screen one 21 px CSS spinner made Chromium and macOS (WindowServer) compose
// the whole window 120 times a second: more power than the 3D office itself.
// CSS follows the same budget with steps() (styles.css, "Frame budget"),
// checked by frame-budget.test.ts.

export const MAX_FPS = 30;

/** One frame of the budget, in ms. */
export const FRAME_MS = 1000 / MAX_FPS;

/** At most `fps` drawn frames per second, whatever the display's refresh
 *  rate. Skipped display frames are carried over, so 90 Hz still averages
 *  `fps`. Call `ready(now)` at the start of every display frame. */
export class FrameCap {
  private interval: number;
  private last = -Infinity;

  constructor(fps = MAX_FPS) {
    this.interval = 1000 / fps;
  }

  /** false = skip this display frame. */
  ready(now: number): boolean {
    const elapsed = now - this.last;
    if (elapsed < this.interval - 1) return false;
    // keep the rhythm: what overshot this interval counts toward the next
    this.last = elapsed >= this.interval && elapsed < 2 * this.interval ? now - (elapsed - this.interval) : now;
    return true;
  }
}
