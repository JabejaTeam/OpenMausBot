import { useSyncExternalStore } from "react";

export const SIMPLE_UI_KEY = "omb-simple-ui";

// Simple UI (fork): a per-device switch that swaps the full workspace chrome
// for a plain chat layout. Only a renderer preference, like show-threads: keep
// a session choice when storage is blocked; another window can supersede it.
let sessionChoice: boolean | undefined;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function simpleUi(): boolean {
  if (sessionChoice !== undefined) return sessionChoice;
  try {
    return storage()?.getItem(SIMPLE_UI_KEY) === "1";
  } catch {
    return false;
  }
}

function notify() {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== SIMPLE_UI_KEY && event.key !== null) return;
  if (event.storageArea && event.storageArea !== storage()) return;
  sessionChoice = undefined;
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function setSimpleUi(enabled: boolean): void {
  sessionChoice = enabled;
  try {
    storage()?.setItem(SIMPLE_UI_KEY, enabled ? "1" : "0");
  } catch {
    // The visible setting still changes for this session when storage is full.
  }
  notify();
}

export function useSimpleUi(): boolean {
  return useSyncExternalStore(subscribe, simpleUi, () => false);
}
