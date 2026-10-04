// Office view (fork): which chats stay rendered (hidden) beside the open one,
// so going back to a bot — or opening one you hovered — is instant. Newest
// first, at most `max`; the open chat is always kept.

export const RECENT_CHATS = 5;

export function remember(ids: readonly string[], id: string, max = RECENT_CHATS): string[] {
  return [id, ...ids.filter((other) => other !== id)].slice(0, max);
}

/** Warm a chat without pushing the open one out of the cache. */
export function prewarm(ids: readonly string[], id: string, openId: string | null, max = RECENT_CHATS): string[] {
  if (ids.includes(id)) return [...ids];
  const kept = ids.filter((other) => other !== openId).slice(0, max - (openId ? 2 : 1));
  return [...(openId && ids.includes(openId) ? [openId] : []), id, ...kept];
}
