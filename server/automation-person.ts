import type { RoutineRunTrigger } from "./routines.ts";

/** Jabeja fork: whose per-person MCP values (WhatsApp, Outlook, Odoo, …) an
 * automation turn mounts. A routine run gets its maker's own servers, as if
 * the maker asked it themselves: routines are made and changed only by their
 * maker or an admin. A webhook brings outside text into the turn, so it never
 * reaches a person's own tools. */
export function automationMcpPerson(
  trigger: RoutineRunTrigger,
  runPerson: string | undefined,
): string | undefined {
  if (trigger === "webhook") return undefined;
  return runPerson;
}
