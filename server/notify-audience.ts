// Jabeja fork: who a notification is for. A bot's answer, question or
// approval rings only for the person whose message started that turn — in
// their own conversation or in someone else's — not for every admin who can
// see the thread. A notification without a known person (a routine nobody
// started by a message) keeps the visibility rule alone.

export interface NotifyAudienceFrame {
  kind?: unknown;
  /** The person the turn ran for (personKey), set by the server's notify(). */
  forPerson?: unknown;
}

/** Whether this frame may reach a stream watched by `person`. Frames other
 * than notify are not this rule's business. */
export function notifyReaches(payload: NotifyAudienceFrame, person: string | undefined): boolean {
  if (payload.kind !== "notify" || typeof payload.forPerson !== "string" || !payload.forPerson) return true;
  return person === payload.forPerson;
}
