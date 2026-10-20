// Whether this browser may manage the workspace: the owner on this machine
// or an admin session (lib/session.ts isOwnerOrAdmin). Settings screens that
// only an admin can use — Activity, a bot's visibility — ask once per page
// load; null while the answer is on its way.
import { useEffect, useState } from "react";

import { actieveOmgeving, useActieveOmgeving } from "./omgevingen";
import { isOwnerOrAdmin, readSessionState } from "./session";

// Fork: one answer per instance behind the voordeur (lib/omgevingen.ts).
const pending = new Map<string, Promise<boolean>>();

function ownerOrAdmin(): Promise<boolean> {
  const key = actieveOmgeving() ?? "";
  let answer = pending.get(key);
  if (!answer) pending.set(key, (answer = readSessionState().then(isOwnerOrAdmin, () => false)));
  return answer;
}

export function useOwnerOrAdmin(): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const omgeving = useActieveOmgeving();
  useEffect(() => {
    let alive = true;
    void ownerOrAdmin().then((value) => {
      if (alive) setAllowed(value);
    });
    return () => {
      alive = false;
    };
  }, [omgeving]);
  return allowed;
}
