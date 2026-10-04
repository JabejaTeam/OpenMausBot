import { useSyncExternalStore } from "react";

export const OFFICE_VIEW_KEY = "omb-office-view";

// Office view (fork): a per-device switch from the bot list to the 3D office.
// Same pattern as simple-ui: a renderer preference, a session choice when
// storage is blocked, and another window can supersede it.
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function officeView(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(OFFICE_VIEW_KEY) === "1";
  } catch {
    return false;
  }
}

function onStorage(event: StorageEvent) {
  if (event.key !== OFFICE_VIEW_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function setOfficeView(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(OFFICE_VIEW_KEY, enabled ? "1" : "0");
  } catch {
    // The view still switches for this session when storage is full.
  }
  for (const listener of listeners) listener();
}

export function useOfficeView(): boolean {
  return useSyncExternalStore(subscribe, officeView, () => false);
}
