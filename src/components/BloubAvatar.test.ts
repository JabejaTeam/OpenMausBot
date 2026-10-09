// @vitest-environment happy-dom
// A still avatar is one engine sample and never starts an animation loop —
// many avatars share a screen. Animated ones share one loop that stops when
// the last of them unmounts.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BloubAvatar, eyesFor } from "./BloubAvatar";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const look = { shape: "capsule", expression: "heureux", color: "bleu" } as const;

describe("BloubAvatar", () => {
  it("renders a still avatar as an svg with a mask, without requestAnimationFrame", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame");
    flushSync(() => root.render(createElement(BloubAvatar, { size: 40, ...look, label: "Mira" })));

    const svg = host.querySelector("svg")!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("aria-label")).toBe("Mira");
    const mask = svg.querySelector("mask")!;
    expect(mask).not.toBeNull();
    expect(svg.querySelector(`[mask="url(#${mask.id})"]`)).not.toBeNull();
    expect(raf).not.toHaveBeenCalled();
  });

  it("gives every instance its own mask id", () => {
    flushSync(() => root.render(createElement("div", null,
      createElement(BloubAvatar, { size: 40, ...look }),
      createElement(BloubAvatar, { size: 40, ...look }),
    )));
    const ids = [...host.querySelectorAll("mask")].map((mask) => mask.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("runs the loop only when animated, and cancels it on unmount", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 7);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    flushSync(() => root.render(createElement(BloubAvatar, { size: 40, ...look, state: "thinking", animated: true })));
    expect(raf).toHaveBeenCalled();
    flushSync(() => root.unmount());
    expect(cancel).toHaveBeenCalledWith(7);
    root = createRoot(host);
  });

  it("drives every live avatar from one shared loop", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 9);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    flushSync(() => root.render(createElement("div", null,
      ...Array.from({ length: 5 }, (_, i) => createElement(BloubAvatar, { key: i, size: 40, ...look, animated: true })),
    )));
    expect(raf).toHaveBeenCalledTimes(1);
    flushSync(() => root.unmount());
    expect(cancel).toHaveBeenCalledTimes(1);
    root = createRoot(host);
  });

  it("draws the end of a morph even when no frame ran while it played (hidden window, stopped working)", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const queued: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => (queued.push(cb), queued.length));
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const flushFrames = () => {
      for (let i = 0; i < 20 && queued.length; i++) {
        flushSync(() => queued.shift()!(now));
        vi.advanceTimersByTime(60);
        now += 60;
      }
    };
    // the body's right edge: ~104 for a whole bloub, ~15 for thinking's dot
    // (the exact outline breathes, so compare its size, not its path)
    const bodyWidth = () => Number(host.querySelector("[data-b=body]")!.getAttribute("d")!.slice(1).split(" ")[0]);

    flushSync(() => root.render(createElement(BloubAvatar, { size: 40, ...look, state: "thinking", animated: true })));
    flushFrames();
    expect(bodyWidth()).toBeLessThan(30);

    // the bot stops working while no frame runs; the next frame comes long after
    flushSync(() => root.render(createElement(BloubAvatar, { size: 40, ...look, state: "idle", animated: true })));
    now += 10_000;
    flushFrames();
    expect(bodyWidth()).toBeGreaterThan(90);
    vi.useRealTimers();
  });

  it("gives a body too light for white eyes dark ones, and every other body white ones", () => {
    expect(eyesFor("#f1efe9")).toBe("#0a0a0c"); // crème
    expect(eyesFor("#f0b429")).toBe("#0a0a0c"); // amber
    expect(eyesFor("#0a0a0c")).toBe("#ffffff"); // ink
    expect(eyesFor("#3b93f0")).toBe("#ffffff"); // blue
    expect(eyesFor("#e8483f")).toBe("#ffffff"); // red
    expect(eyesFor("#3ecf8e")).toBe("#ffffff"); // green
  });
});
