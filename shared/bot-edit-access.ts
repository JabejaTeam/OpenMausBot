// Fork: who may change an agent. One rule, read by the server's bot routes
// and by the app's settings screens:
//   - admins (and the owner on this machine) change every agent;
//   - a personal agent — private to exactly one address, like Clank for Yren
//     — is changed by that person too: its profile and its look;
//   - anyone else only keeps their own reading state (unread, pins).
// Pure: no store, no server.

/** Fields of PATCH /api/bots/:id that are one viewer's reading state, not
 * the agent's settings: every person who sees the agent may change them. */
export const READING_BOT_FIELDS: readonly string[] = ["unread", "pinned", "pinnedMessageId"];

/** Fields of PATCH /api/bots/:id that are the agent's look: its personal
 * owner may change them as well. */
export const LOOK_BOT_FIELDS: readonly string[] = ["color", "mascotExpression", "mascotBody", "bloub"];

/** The one address a personal agent belongs to: a private audience that
 * names exactly one person (not an @domain). Undefined for any other agent. */
export function personalOwner(visibility: unknown): string | undefined {
  if (!visibility || typeof visibility !== "object") return undefined;
  const { people, private: isPrivate } = visibility as { people?: unknown; private?: unknown };
  if (isPrivate !== true || !Array.isArray(people) || people.length !== 1) return undefined;
  const only = people[0];
  if (typeof only !== "string" || only.startsWith("@") || !only.includes("@")) return undefined;
  return only.trim().toLowerCase();
}

/** Whether this person owns this personal agent. */
export function ownsBot(email: string | undefined, visibility: unknown): boolean {
  const owner = personalOwner(visibility);
  return Boolean(owner && email && email.trim().toLowerCase() === owner);
}

/** Whether a viewer may change an agent's settings (profile and look). */
export function canEditBot(viewer: { admin: boolean; email?: string }, visibility: unknown): boolean {
  return viewer.admin || ownsBot(viewer.email, visibility);
}

/** The first field of a PATCH /api/bots/:id body a non-admin may not send,
 * or null. `owner`: the viewer owns this personal agent. */
export function botPatchViolation(body: Record<string, unknown>, owner: boolean): string | null {
  for (const key of Object.keys(body)) {
    if (READING_BOT_FIELDS.includes(key)) continue;
    if (owner && LOOK_BOT_FIELDS.includes(key)) continue;
    return key;
  }
  return null;
}
