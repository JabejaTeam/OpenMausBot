import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FrameCap, MAX_FPS } from "./frame-budget";

const SRC = join(__dirname, "..");

/** How many of `frames` display frames at `hz` the cap lets through. */
function drawn(fps: number, hz: number, frames: number): number {
  const cap = new FrameCap(fps);
  let count = 0;
  for (let i = 0; i < frames; i += 1) if (cap.ready(i * (1000 / hz))) count += 1;
  return count;
}

describe("FrameCap", () => {
  it("draws MAX_FPS by default", () => {
    const cap = new FrameCap();
    let count = 0;
    for (let i = 0; i < 1200; i += 1) if (cap.ready(i * (1000 / 120))) count += 1;
    expect(count).toBe(MAX_FPS * 10);
  });

  it("draws every frame of a display at its own rate", () => {
    expect(drawn(60, 60, 600)).toBe(600);
  });

  it("draws every fourth frame of a 120 Hz display at 30", () => {
    expect(drawn(30, 120, 1200)).toBe(300);
  });

  it("averages 30 on a 90 Hz display, not 22.5", () => {
    expect(drawn(30, 90, 900)).toBeGreaterThanOrEqual(295);
  });
});

/** Keyframe stops (0..1) per @keyframes name; Tailwind's own spin and pulse are not in the file. */
function keyframeStops(css: string): Map<string, number[]> {
  const stops = new Map<string, number[]>([["spin", [0, 1]], ["pulse", [0, 0.5, 1]]]);
  for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    // the block: balance braces from the opening one
    let depth = 0;
    let end = match.index! + match[0].length - 1;
    for (; end < css.length; end += 1) {
      if (css[end] === "{") depth += 1;
      else if (css[end] === "}" && --depth === 0) break;
    }
    const body = css.slice(match.index! + match[0].length, end);
    const at = new Set<number>();
    for (const selector of body.matchAll(/([^{}]+)\{/g)) {
      for (const part of selector[1].split(",")) {
        const word = part.trim();
        if (word === "from") at.add(0);
        else if (word === "to") at.add(1);
        else if (word.endsWith("%")) at.add(parseFloat(word) / 100);
      }
    }
    at.add(0).add(1);
    stops.set(match[1], [...at].sort((a, b) => a - b));
  }
  return stops;
}

/** Every `name duration timing … infinite` animation in the stylesheets. */
function infiniteAnimations(css: string): string[] {
  return [...css.matchAll(/(?:--animate-[\w-]+|animation)\s*:\s*([^;]*\binfinite\b[^;]*);/g)].map((match) => match[1].trim());
}

function seconds(value: string): number {
  return value.endsWith("ms") ? parseFloat(value) / 1000 : parseFloat(value);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("frame budget in CSS", () => {
  const css = ["styles.css", "mascot-preview.css"].map((file) => readFileSync(join(SRC, file), "utf8")).join("\n");
  const stops = keyframeStops(css);

  it("steps every infinite animation at no more than MAX_FPS per keyframe segment", () => {
    const animations = infiniteAnimations(css);
    expect(animations.length).toBeGreaterThan(5);
    for (const animation of animations) {
      const [name, duration] = animation.split(/\s+/);
      if (/\bstep-(end|start)\b/.test(animation)) continue; // one change per cycle
      const steps = /steps\((\d+)/.exec(animation);
      expect(steps, `${animation}: not stepped`).not.toBeNull();
      const keys = stops.get(name);
      expect(keys, `${name}: no @keyframes`).toBeDefined();
      const shortest = Math.min(...keys!.slice(1).map((stop, index) => stop - keys![index]).filter((span) => span > 0));
      const fps = Number(steps![1]) / (shortest * seconds(duration));
      expect(fps, `${animation}: ${fps.toFixed(1)} fps`).toBeLessThanOrEqual(MAX_FPS + 0.5);
    }
  });

  it("has no inline infinite animation outside the stylesheet's tokens", () => {
    const inline = sourceFiles(SRC).filter((file) => /animation:\s*`[^`]*infinite/.test(readFileSync(file, "utf8")));
    expect(inline).toEqual([]);
  });
});
