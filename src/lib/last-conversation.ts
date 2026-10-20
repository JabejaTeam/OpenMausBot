// Which conversation was open on this device last time. The pick is
// conversation-level - a bot or a room id, never a thread id: the server
// already persists each record's current thread, so restoring the
// conversation reopens that thread by itself (with threads hidden, a bot's
// main thread instead: the store opens it as the bot's row would).
export const LAST_CONVERSATION_KEY = "openmausbot.lastConversation.v1";

/** Fork: one per instance behind the voordeur (lib/omgevingen.ts). */
const keyFor = (omgeving?: string) => (omgeving ? `${LAST_CONVERSATION_KEY}.${omgeving}` : LAST_CONVERSATION_KEY);

/** The conversation open here last, or null when storage holds nothing
 * usable - absent, blank, or a record a read failure cannot parse. */
export function readLastConversation(omgeving?: string): string | null {
  try {
    return globalThis.localStorage?.getItem(keyFor(omgeving))?.trim() || null;
  } catch {
    return null;
  }
}

/** Remember the open conversation for the next launch. */
export function rememberConversation(id: string, omgeving?: string): void {
  try {
    globalThis.localStorage?.setItem(keyFor(omgeving), id);
  } catch {
    // Private windows may refuse storage; the choice still holds this session.
  }
}
