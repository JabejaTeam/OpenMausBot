// Jabeja fork: live dictation through Soniox, for every page — the browser,
// and the Mac app on a remote server, where Apple's on-device dictation is
// off. The browser streams its microphone straight to Soniox over a websocket
// (src/lib/soniox-dictation.ts); this route only trades the permanent key for
// a single-use one that is valid for 60 seconds, so the real key never leaves
// the server. Same design as the Hubigen client UI (hermes-ops ui/stt.py),
// with the same Soniox account.
import { PASS, type RouteHandler } from "./table.ts";

export const SONIOX_API = "https://api.soniox.com/v1";
/** Seconds the browser gets to OPEN the websocket with a minted key. */
export const SONIOX_TOKEN_TTL_S = 60;
/** How long one dictation may run once open; a long one must not stop mid-sentence. */
export const SONIOX_MAX_SESSION_S = 7200;
const MINT_TIMEOUT_MS = 15_000;

export interface ForkDictationRouteDeps {
  /** The permanent Soniox key; undefined = dictation through Soniox is off. */
  sonioxKey(): string | undefined;
  fetch?: typeof fetch;
}

/** Trade the permanent key for a single-use websocket key. */
export async function mintSonioxToken(key: string, doFetch: typeof fetch = fetch): Promise<{ token: string; expiresAt?: string }> {
  const res = await doFetch(`${SONIOX_API}/auth/temporary-api-key`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      usage_type: "transcribe_websocket",
      expires_in_seconds: SONIOX_TOKEN_TTL_S,
      max_session_duration_seconds: SONIOX_MAX_SESSION_S,
      single_use: true,
    }),
    signal: AbortSignal.timeout(MINT_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`soniox ${res.status}: ${text.slice(0, 200)}`);
  const payload = JSON.parse(text) as { api_key?: unknown; expires_at?: unknown };
  if (typeof payload.api_key !== "string" || !payload.api_key) throw new Error("soniox answered without api_key");
  return { token: payload.api_key, expiresAt: typeof payload.expires_at === "string" ? payload.expires_at : undefined };
}

export function createForkDictationRoutes(deps: ForkDictationRouteDeps): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (path === "/api/dictation" && method === "GET") {
      return json(res, 200, { soniox: Boolean(deps.sonioxKey()) });
    }
    if (path === "/api/dictation/token" && method === "POST") {
      const key = deps.sonioxKey();
      if (!key) return json(res, 404, { error: "Soniox dictation is not set up on this server" });
      try {
        return json(res, 200, await mintSonioxToken(key, deps.fetch));
      } catch (error) {
        // the detail is for the server log, not for the page
        console.error("[dictation] Soniox mint failed:", error instanceof Error ? error.message : error);
        return json(res, 502, { error: "Soniox gave no key" });
      }
    }
    return PASS;
  };
}
