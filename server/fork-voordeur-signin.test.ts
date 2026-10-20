import { describe, expect, it } from "vitest";
import { createVoordeurSignIn, voordeurSignature } from "./fork-voordeur-signin.ts";

const SECRET = "s".repeat(40);
const NOW = 1_800_000_000_000;

function signed(body: object, { secret = SECRET, at = NOW, nonce = "n".repeat(24) } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = String(Math.floor(at / 1000));
  return { timestamp, nonce, signature: `v1=${voordeurSignature(secret, timestamp, nonce, raw)}`, body: raw };
}

describe("voordeur sign-in", () => {
  it("accepts a fresh signed request once and reads the email", () => {
    const door = createVoordeurSignIn({ secret: SECRET, now: () => NOW });
    const request = signed({ email: " Miguel@Ripal.be ", label: "voordeur" });
    expect(door.check(request)).toEqual({ status: 200, email: "miguel@ripal.be", label: "voordeur" });
    expect(door.check(request)).toEqual({ status: 401, error: "replayed_request" });
  });

  it("refuses another secret, a changed body, an old clock and no email", () => {
    const door = createVoordeurSignIn({ secret: SECRET, now: () => NOW });
    expect(door.check(signed({ email: "a@b.be" }, { secret: "x".repeat(40) }))).toEqual({ status: 401, error: "invalid_signature" });
    const tampered = signed({ email: "a@b.be" });
    expect(door.check({ ...tampered, body: Buffer.from(JSON.stringify({ email: "boss@b.be" })) })).toEqual({ status: 401, error: "invalid_signature" });
    expect(door.check(signed({ email: "a@b.be" }, { at: NOW - 120_000 }))).toEqual({ status: 401, error: "stale_request" });
    expect(door.check(signed({ label: "x" }, { nonce: "m".repeat(24) }))).toEqual({ status: 400, error: "invalid_body" });
    expect(door.check({ timestamp: undefined, nonce: undefined, signature: undefined, body: Buffer.from("{}") })).toEqual({ status: 401, error: "invalid_signature" });
  });
});
