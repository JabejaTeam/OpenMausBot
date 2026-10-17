import type { RoutineRunTrigger } from "./routines.ts";

/** Jabeja fork: whose per-person MCP values (WhatsApp, Outlook, …) an
 * automation turn mounts. Only a routine run for the workspace owner gets the
 * owner's own servers: routines are made and changed by the owner or an admin.
 * A webhook brings outside text into the turn, and a routine made for someone
 * else stays on the shared values, so neither reaches a person's own tools. */
export function automationMcpPerson(
  trigger: RoutineRunTrigger,
  runPerson: string | undefined,
  owner: string | undefined,
): string | undefined {
  if (trigger === "webhook") return undefined;
  return runPerson !== undefined && runPerson === owner ? runPerson : undefined;
}
