// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { claimHoldToTalk, dictatedText, pickDictationEngine, useHoldToTalk } from "./soniox-dictation";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("dictatedText", () => {
  it("puts what was said after what was typed, rebuilt each time", () => {
    expect(dictatedText("", " hallo ")).toBe("hallo");
    expect(dictatedText("Vraag:", "hoe gaat het")).toBe("Vraag: hoe gaat het");
    expect(dictatedText("Vraag: ", "hoe")).toBe("Vraag: hoe");
    expect(dictatedText("Vraag:", "")).toBe("Vraag:");
  });
});

describe("pickDictationEngine", () => {
  it("keeps the picked engine where it works, else Soniox, else Apple", () => {
    expect(pickDictationEngine("apple", { soniox: true, apple: true })).toBe("apple");
    expect(pickDictationEngine("apple", { soniox: true, apple: false })).toBe("soniox");
    expect(pickDictationEngine(null, { soniox: false, apple: true })).toBe("apple");
    expect(pickDictationEngine(null, { soniox: false, apple: false })).toBeNull();
  });
});

describe("useHoldToTalk", () => {
  const roots: Array<ReturnType<typeof createRoot>> = [];
  afterEach(() => {
    act(() => roots.splice(0).forEach((root) => root.unmount()));
  });

  function mount(enabled = true) {
    const calls = { hold: vi.fn(), release: vi.fn(), abort: vi.fn() };
    let me: symbol | undefined;
    function Probe() {
      me = useHoldToTalk(enabled, calls.hold, calls.release, calls.abort);
      return null;
    }
    const root = createRoot(document.createElement("div"));
    roots.push(root);
    act(() => root.render(createElement(Probe)));
    return { calls, me: () => me! };
  }

  const key = (type: "keydown" | "keyup", key: string, mods: { alt?: boolean; meta?: boolean } = {}) =>
    window.dispatchEvent(new KeyboardEvent(type, { key, altKey: mods.alt, metaKey: mods.meta }));

  it("starts when ⌥ and ⌘ are both down and stops when one is let go", () => {
    const { calls } = mount();
    key("keydown", "Alt", { alt: true });
    expect(calls.hold).not.toHaveBeenCalled();
    key("keydown", "Meta", { alt: true, meta: true });
    expect(calls.hold).toHaveBeenCalledTimes(1);
    key("keydown", "Meta", { alt: true, meta: true });
    expect(calls.hold).toHaveBeenCalledTimes(1);
    key("keyup", "Meta", { alt: true });
    expect(calls.release).toHaveBeenCalledTimes(1);
    expect(calls.abort).not.toHaveBeenCalled();
  });

  it("gives way to a shortcut: ⌥⌘ plus another key aborts", () => {
    const { calls } = mount();
    key("keydown", "Meta", { alt: true, meta: true });
    key("keydown", "i", { alt: true, meta: true });
    expect(calls.abort).toHaveBeenCalledTimes(1);
    key("keyup", "Meta");
    expect(calls.release).not.toHaveBeenCalled();
  });

  it("stops when the window loses focus mid-hold", () => {
    const { calls } = mount();
    key("keydown", "Alt", { alt: true, meta: true });
    window.dispatchEvent(new Event("blur"));
    expect(calls.release).toHaveBeenCalledTimes(1);
  });

  it("lets only the composer focused last answer", () => {
    const first = mount();
    const second = mount();
    act(() => claimHoldToTalk(second.me()));
    key("keydown", "Meta", { alt: true, meta: true });
    expect(first.calls.hold).not.toHaveBeenCalled();
    expect(second.calls.hold).toHaveBeenCalledTimes(1);
  });

  it("does nothing while off", () => {
    const { calls } = mount(false);
    key("keydown", "Meta", { alt: true, meta: true });
    expect(calls.hold).not.toHaveBeenCalled();
  });
});
