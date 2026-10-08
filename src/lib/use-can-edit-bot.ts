// Fork: whether this person may change an agent — an admin (or the owner on
// this machine), or the person a personal agent belongs to. The rule lives in
// shared/bot-edit-access.ts; the server marks a member's own personal agent
// `ownedByViewer`, since a member never receives an agent's audience.
import { useOwnerOrAdmin } from "./use-owner-or-admin";

export function useCanEditBot(bot: { ownedByViewer?: true } | null | undefined): boolean {
  const admin = useOwnerOrAdmin();
  return admin === true || Boolean(bot?.ownedByViewer);
}
