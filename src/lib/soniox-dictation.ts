// Jabeja fork: live dictation through Soniox — the page's side of
// server/routes/fork-dictation.ts. The browser opens its own websocket to
// Soniox (@soniox/react) and the words appear in the composer while you
// speak; nothing is sent until you press send. The server only hands out a
// single-use key that opens one connection within 60 seconds; the permanent
// key never reaches a page. Ported from the Hubigen client UI
// (hermes-ops ui/app/lib/useDicteren.ts), which runs on the same account.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRecording } from "@soniox/react";

type Api = <T = unknown>(path: string, init?: RequestInit & { timeoutMs?: number }) => Promise<T>;

export const SONIOX_MODEL = "stt-rt-v5";
export const SONIOX_LANGUAGE_HINTS = ["nl", "en"];
/** A prefetched key is used only while it surely still opens (the server gives 60 s). */
const TOKEN_MAX_AGE_MS = 45_000;
/** A hanging connection stops instead of looking like it listens. */
const CONNECT_TIMEOUT_MS = 10_000;

export type DictationEngine = "soniox" | "apple";
const ENGINE_KEY = "omb.dictation.engine";

export function storedDictationEngine(): DictationEngine | null {
  try {
    const value = localStorage.getItem(ENGINE_KEY);
    return value === "soniox" || value === "apple" ? value : null;
  } catch {
    return null;
  }
}

export function storeDictationEngine(engine: DictationEngine): void {
  try {
    localStorage.setItem(ENGINE_KEY, engine);
  } catch {
    /* a private window keeps the default */
  }
}

/** The engine a start uses: the one picked last when it is here, else Soniox, else Apple. */
export function pickDictationEngine(
  stored: DictationEngine | null,
  available: { soniox: boolean; apple: boolean },
): DictationEngine | null {
  if (stored && available[stored]) return stored;
  if (available.soniox) return "soniox";
  if (available.apple) return "apple";
  return null;
}

/** The text in the box while dictating: what was there before, then what was said.
 * Rebuilt from the base on every change, never appended: Soniox revises its
 * partials, and appending would stack those revisions into doubled sentences. */
export function dictatedText(base: string, said: string): string {
  const spoken = said.trim();
  if (!spoken) return base;
  return base + (base && !/\s$/.test(base) ? " " : "") + spoken;
}

export interface SonioxDictation {
  /** Soniox is set up on the server; undefined until asked. */
  available: boolean | undefined;
  listening: boolean;
  connecting: boolean;
  error: string | null;
  /** Prefetch a key, so the click does not wait on the network. */
  warm: () => void;
  start: () => void;
  /** Stop and keep the last words (they finish into final text). */
  stop: () => void;
  /** Stop now. `restore` puts the box back to what it held before the start
   * (Escape); without it the box stays as it is (a send just emptied it). */
  cancel: (restore?: boolean) => void;
}

export function useSonioxDictation(
  api: Api,
  text: { current: () => string; write: (next: string) => void },
): SonioxDictation {
  const [available, setAvailable] = useState<boolean | undefined>(undefined);
  const [listening, setListening] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = useRef("");
  const mounted = useRef(true);
  // Rises with every start and cancel, so a late timeout never kills the next one.
  const attempt = useRef(0);
  const stored = useRef<{ token: string; at: number } | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    api<{ soniox?: boolean }>("/api/dictation")
      .then((answer) => live && setAvailable(Boolean(answer?.soniox)))
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
  }, [api]);

  const freshToken = useCallback(async (): Promise<string> => {
    const answer = await api<{ token?: string }>("/api/dictation/token", { method: "POST", body: "{}", timeoutMs: 20_000 });
    if (!answer?.token) throw new Error("no Soniox key");
    return answer.token;
  }, [api]);

  const warm = useCallback(() => {
    if (!available || stored.current || inFlight.current) return;
    inFlight.current = freshToken()
      .then((token) => {
        stored.current = { token, at: Date.now() };
      })
      .catch(() => {
        /* the click tries again */
      })
      .finally(() => {
        inFlight.current = null;
      });
  }, [available, freshToken]);

  const takeToken = useCallback(async (): Promise<string> => {
    if (inFlight.current) await inFlight.current;
    const kept = stored.current;
    stored.current = null;
    if (kept && Date.now() - kept.at < TOKEN_MAX_AGE_MS) return kept.token;
    return freshToken();
  }, [freshToken]);
  const takeTokenRef = useRef(takeToken);
  takeTokenRef.current = takeToken;

  const recording = useRecording({
    // runs per connection, also on a reconnect: every one gets a fresh single-use key
    config: async () => ({ api_key: await takeTokenRef.current() }),
    model: SONIOX_MODEL,
    language_hints: SONIOX_LANGUAGE_HINTS,
    enable_language_identification: true,
    enable_endpoint_detection: true,
    // a dropped second of wifi must not end the dictation; buffered audio is resent
    auto_reconnect: true,
    max_reconnect_attempts: 5,
    reset_transcript_on_reconnect: false,
    onConnected: () => {
      if (!mounted.current) return;
      setConnecting(false);
      setListening(true);
    },
    onError: (err: unknown) => {
      if (!mounted.current) return;
      setListening(false);
      setConnecting(false);
      // an error belongs to an attempt; before the first start there is none
      if (attempt.current === 0) return;
      setError(err instanceof Error ? err.message : "dictation dropped");
    },
    onFinished: () => {
      if (!mounted.current) return;
      setListening(false);
      setConnecting(false);
    },
  });
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  // mirror what is said into the box while it comes in
  useEffect(() => {
    // stopping still counts: the last words turn final after stop()
    if (!listening && !recording.isActive) return;
    textRef.current.write(dictatedText(base.current, `${recording.finalText} ${recording.partialText}`));
  }, [recording.finalText, recording.partialText, listening, recording.isActive]);

  const start = useCallback(() => {
    const id = ++attempt.current;
    setError(null);
    setConnecting(true);
    base.current = textRef.current.current();
    try {
      recordingRef.current.clearTranscript();
      recordingRef.current.start();
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : "could not open the microphone");
      return;
    }
    setTimeout(() => {
      if (attempt.current !== id || !mounted.current || recordingRef.current.isActive) return;
      attempt.current++;
      try {
        recordingRef.current.cancel();
      } catch {}
      setConnecting(false);
      setListening(false);
      setError("connecting took too long");
    }, CONNECT_TIMEOUT_MS);
  }, []);

  const stop = useCallback(() => {
    // stop(), not cancel(): the last partials still finish into final text —
    // exactly the words someone just said
    setConnecting(false);
    void recordingRef.current.stop().catch(() => {});
  }, []);

  const cancel = useCallback((restore = true) => {
    attempt.current++;
    try {
      recordingRef.current.cancel();
    } catch {}
    setConnecting(false);
    setListening(false);
    if (restore) textRef.current.write(base.current);
  }, []);

  // an error belongs to the attempt just made; it does not stay
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(timer);
  }, [error]);

  return { available, listening, connecting, error, warm, start, stop, cancel };
}

/** ⌥⌘ held = dictate, released = stop. Only one composer answers: the one
 * focused last (or the first mounted), so a split view does not record twice. */
let holdOwner: symbol | null = null;

export function claimHoldToTalk(me: symbol): void {
  holdOwner = me;
}

export function useHoldToTalk(enabled: boolean, onHold: () => void, onRelease: () => void, onAbort: () => void): symbol {
  const me = useRef(Symbol("composer")).current;
  const handlers = useRef({ onHold, onRelease, onAbort });
  handlers.current = { onHold, onRelease, onAbort };

  useEffect(() => {
    if (!holdOwner) holdOwner = me;
    return () => {
      if (holdOwner === me) holdOwner = null;
    };
  }, [me]);

  useEffect(() => {
    if (!enabled) return;
    let held = false;
    const isModifier = (key: string) => key === "Alt" || key === "Meta";
    const down = (event: KeyboardEvent) => {
      if (holdOwner !== me) return;
      if (held) {
        // ⌥⌘ plus another key is a shortcut (⌥⌘I, …), not dictation
        if (!isModifier(event.key)) {
          held = false;
          handlers.current.onAbort();
        }
        return;
      }
      if (event.repeat || !isModifier(event.key) || !event.altKey || !event.metaKey || event.ctrlKey || event.shiftKey) return;
      held = true;
      handlers.current.onHold();
    };
    const up = (event: KeyboardEvent) => {
      if (!held || !isModifier(event.key)) return;
      held = false;
      handlers.current.onRelease();
    };
    // the keyup never comes when the window loses focus mid-hold
    const blur = () => {
      if (!held) return;
      held = false;
      handlers.current.onRelease();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", blur);
      if (held) handlers.current.onRelease();
    };
  }, [enabled, me]);

  return me;
}
