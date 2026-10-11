// @vitest-environment happy-dom
// fork: the heads stand still while their window is not the active one.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let focused = true;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  focused = true;
  vi.spyOn(document, "hasFocus").mockImplementation(() => focused);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function ticks() {
  const { subscribe } = await import("./ticker");
  const fn = vi.fn();
  const stop = subscribe(fn, 50);
  return { fn, stop };
}

it("ticks while the window is active", async () => {
  const { fn, stop } = await ticks();
  vi.advanceTimersByTime(500);
  expect(fn.mock.calls.length).toBeGreaterThan(5);
  stop();
});

it("stands still while another window is active, and moves again on focus", async () => {
  const { fn, stop } = await ticks();
  vi.advanceTimersByTime(200);
  focused = false;
  window.dispatchEvent(new Event("blur"));
  const before = fn.mock.calls.length;
  vi.advanceTimersByTime(2000);
  expect(fn.mock.calls.length).toBe(before);

  focused = true;
  window.dispatchEvent(new Event("focus"));
  vi.advanceTimersByTime(500);
  expect(fn.mock.calls.length).toBeGreaterThan(before);
  // the first tick after the sleep is not one huge step
  expect(fn.mock.calls[before]![0]).toBe(0);
  stop();
});

it("does not start while the window is inactive", async () => {
  focused = false;
  const { fn, stop } = await ticks();
  vi.advanceTimersByTime(1000);
  expect(fn).not.toHaveBeenCalled();
  stop();
});
