// Jabeja fork: the page asks once to turn notifications on (notificationPromptDue).
import { afterEach, describe, expect, it, vi } from "vitest";
import { notificationPromptDue, putOffNotificationPrompt } from "./notify";

const storage = new Map<string, string>();

function page(permission: NotificationPermission | undefined) {
  if (permission) vi.stubGlobal("Notification", { permission });
  vi.stubGlobal("localStorage", { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) });
}

afterEach(() => {
  vi.unstubAllGlobals();
  storage.clear();
});

describe("notificationPromptDue", () => {
  it("offers it while the browser has not been answered", () => {
    page("default");
    expect(notificationPromptDue()).toBe(true);
  });

  it("never once the browser answered, either way", () => {
    page("granted");
    expect(notificationPromptDue()).toBe(false);
    page("denied");
    expect(notificationPromptDue()).toBe(false);
  });

  it("not where notifications do not exist", () => {
    vi.stubGlobal("Notification", undefined);
    expect(notificationPromptDue()).toBe(false);
  });

  it("stays away once put off", () => {
    page("default");
    putOffNotificationPrompt();
    expect(notificationPromptDue()).toBe(false);
  });
});
