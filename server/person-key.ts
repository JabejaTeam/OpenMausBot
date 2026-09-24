import { createHash } from "node:crypto";

/** The opaque, stable key a person is known by: in cards, thread starters and
 * per-person MCP values. One-way, so it can travel where an email may not. */
export function personKeyFor(basis: string): string {
  return `p_${createHash("sha256").update(basis).digest("base64url").slice(0, 22)}`;
}

export function personKeyForEmail(email: string): string {
  return personKeyFor(`email:${email.trim().toLowerCase()}`);
}
