// @vitest-environment happy-dom
// A still avatar is one engine sample and never starts an animation loop —
// many avatars share a screen. An animated one runs the loop and stops it
// on unmount.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BloubAvatar } from "./BloubAvatar";

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
});
