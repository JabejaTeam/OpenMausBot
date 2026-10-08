// Fork: who may leave Simple. Simple UI is everyone's app; the full UI
// (Advanced mode, the full sidebar) is for the machine's owner and admins
// only. main.tsx sets this from the session before the app renders.
let allowed = true;

export function setAdvancedAllowed(value: boolean): void {
  allowed = value;
}

export function advancedAllowed(): boolean {
  return allowed;
}
