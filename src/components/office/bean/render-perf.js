// Render layer: frame-cost policies that belong to the renderer, not to agents.

/** Compile every shader and upload every buffer before the first visible frame,
 *  so nothing hitches when an agent or a headgear piece first shows up.
 *  `showAll(on)` makes everything that can ever appear visible (true) and puts
 *  the scene back (false). `render` must be the frame's real render call (with
 *  post-processing, if any). Call while the loading state is still on screen. */
export async function warmUp(renderer, scene, camera, showAll, render = () => renderer.render(scene, camera)) {
  showAll(true);
  await renderer.compileAsync(scene, camera); // parallel compile where the driver supports it
  renderer.shadowMap.needsUpdate = true;
  render(); // the real pipeline: post-processing override materials, shadow programs, buffer uploads
  showAll(false);
}

/** Shadow map on demand: re-rendered when something changed (invalidate()),
 *  and while agents animate only every `every`-th frame. The shadow pass draws
 *  every caster a second time, so this saves most of it. A camera move never
 *  needs it (the map lives in light space). */
export class ShadowScheduler {
  constructor(renderer, { every = 2 } = {}) {
    this.renderer = renderer;
    this.every = every;
    this.frame = 0;
    this.dirty = true;
    renderer.shadowMap.autoUpdate = false;
  }
  invalidate() { this.dirty = true; }
  /** Call once per frame before rendering. */
  tick(animating) {
    this.frame++;
    if (this.dirty || (animating && this.frame % this.every === 0)) {
      this.renderer.shadowMap.needsUpdate = true;
      this.dirty = false;
    }
  }
}

/** Pixel ratio that steps down (by 0.25, not below `min`) when frames run late
 *  and steps back up once there is headroom. Each time it has to step down
 *  again after going up, it waits twice as long before trying up again. */
export class AdaptiveResolution {
  constructor(renderer, { max = Math.min(window.devicePixelRatio, 2), min = 1, onChange = () => {} } = {}) {
    Object.assign(this, { renderer, max, min, onChange });
    this.ratio = max;
    this.avg = 16.7;
    this.slow = 0;
    this.fast = 0;
    this.upAfter = 180; // frames of headroom before stepping up (~3 s)
    this.wentUp = false;
    renderer.setPixelRatio(max);
  }
  /** Call once per drawn frame with the interval since the previous drawn
   *  frame (ms). Only back-to-back frames say anything about the frame rate:
   *  after a pause (nothing to draw) call with no interval, it is skipped. */
  tick(intervalMs) {
    if (intervalMs === undefined) return;
    this.avg += (Math.min(intervalMs, 100) - this.avg) * 0.1;
    this.slow = this.avg > 20 ? this.slow + 1 : 0;   // below ~50 fps
    this.fast = this.avg < 17.5 ? this.fast + 1 : 0; // holding 60 fps
    if (this.slow > 30 && this.ratio > this.min) {
      if (this.wentUp) this.upAfter *= 2;
      this.set(this.ratio - 0.25);
      this.wentUp = false;
    } else if (this.fast > this.upAfter && this.ratio < this.max) {
      this.set(this.ratio + 0.25);
      this.wentUp = true;
    }
  }
  set(ratio) {
    this.ratio = Math.min(this.max, Math.max(this.min, ratio));
    this.slow = -30; // grace: let the average settle at the new ratio before judging again
    this.fast = 0;
    this.renderer.setPixelRatio(this.ratio);
    this.onChange(this.ratio);
  }
}
