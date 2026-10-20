// Jabeja fork: one sign-in for every OpenMausBot behind the voordeur
// (bots.jabeja.be, repo omb-voordeur). A person proves their email once, on
// one instance; the voordeur then asks every other instance whose sign-in
// list holds that email for a session of its own, with a request signed by a
// secret it shares with that instance only (env OMB_VOORDEUR_SECRET). The
// result is the same session an email code gives: same list, same scopes.
// Without the env the route does not exist.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const VOORDEUR_SESSION_PATH = "/api/auth/voordeur-session";
/** How far the voordeur's clock may be off, in seconds. */
export const VOORDEUR_SKEW_S = 60;
const NONCE_MS = 5 * 60_000;
const MAX_NONCES = 10_000;

/** The voordeur's side of the signature (voordeur.mjs voordeurSignature). */
export function voordeurSignature(secret: string, timestamp: string, nonce: string, body: Buffer | string): string {
  const bodyHash = createHash("sha256").update(body).digest("hex");
  return createHmac("sha256", secret).update(`v1\n${timestamp}\n${nonce}\nPOST\n${VOORDEUR_SESSION_PATH}\n${bodyHash}`).digest("base64url");
}

export type VoordeurSignInResult = { status: 200; email: string; label: string } | { status: number; error: string };

export function createVoordeurSignIn(options: { secret: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  const nonces = new Map<string, number>();
  return {
    /** Signature, clock, nonce, then the body: nothing is believed before the signature holds. */
    check(input: { timestamp: string | undefined; nonce: string | undefined; signature: string | undefined; body: Buffer }): VoordeurSignInResult {
      const timestamp = input.timestamp ?? "", nonce = input.nonce ?? "";
      const presented = /^v1=([A-Za-z0-9_-]{43})$/.exec(input.signature ?? "")?.[1];
      const expected = Buffer.from(voordeurSignature(options.secret, timestamp, nonce, input.body), "base64url");
      const given = presented ? Buffer.from(presented, "base64url") : Buffer.alloc(0);
      const matches = given.length === expected.length && timingSafeEqual(given, expected);
      if (!presented || !matches || !/^\d{1,12}$/.test(timestamp) || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return { status: 401, error: "invalid_signature" };
      const at = now();
      if (Math.abs(at / 1000 - Number(timestamp)) > VOORDEUR_SKEW_S) return { status: 401, error: "stale_request" };
      for (const [seen, until] of nonces) if (until <= at) nonces.delete(seen);
      if (nonces.has(nonce)) return { status: 401, error: "replayed_request" };
      if (nonces.size >= MAX_NONCES) return { status: 503, error: "busy" };
      nonces.set(nonce, at + NONCE_MS);
      let parsed: unknown;
      try { parsed = JSON.parse(input.body.toString("utf8")); } catch { return { status: 400, error: "invalid_body" }; }
      const email = typeof (parsed as { email?: unknown })?.email === "string" ? (parsed as { email: string }).email.trim().toLowerCase() : "";
      const label = typeof (parsed as { label?: unknown })?.label === "string" ? (parsed as { label: string }).label.trim().slice(0, 120) : "";
      if (!email.includes("@")) return { status: 400, error: "invalid_body" };
      return { status: 200, email, label };
    },
  };
}
