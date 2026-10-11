// Fork: phones that want a push when the app is closed. A native app signs
// in, asks iOS for an APNs device token and registers it here; the server
// pushes the same notifications its `notify` frame carries, only to the
// person the frame is for (notify-audience.ts). One device record per token,
// tied to the session that registered it: when that session ends, the phone
// stops getting pushes.
// One small server-private file (<data>/push-devices.json, 0600).
import { readFileSync } from "node:fs";

import { writeFileAtomic } from "./atomic.ts";

export type ApnsEnvironment = "production" | "sandbox";

export interface PushDevice {
  token: string;
  person: string;
  sessionId: string;
  environment: ApnsEnvironment;
  /** the app's bundle id, the APNs topic */
  topic: string;
  updatedAt: number;
}

const TOKEN = /^[0-9a-f]{64,200}$/;
const KEY = /^[\w-]{1,128}$/;
const TOPIC = /^[\w.-]{1,128}$/;
/** Phones kept per person; the oldest go first. */
export const MAX_DEVICES_PER_PERSON = 10;

export class PushDevices {
  private readonly devices = new Map<string, PushDevice>();
  private readonly file: string;

  constructor(file: string) {
    this.file = file;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return; // absent or unreadable: no phone registered yet
    }
    if (!Array.isArray(raw)) return;
    for (const entry of raw) {
      const device = valid(entry);
      if (device) this.devices.set(device.token, device);
    }
  }

  /** Register (or move) a phone to this person and session. False for invalid input. */
  register(input: { token: unknown; person: string; sessionId: string; environment: unknown; topic: unknown }, now = Date.now()): boolean {
    const device = valid({ ...input, token: typeof input.token === "string" ? input.token.toLowerCase() : input.token, updatedAt: now });
    if (!device) return false;
    this.devices.delete(device.token);
    this.devices.set(device.token, device);
    const own = [...this.devices.values()].filter((d) => d.person === device.person);
    for (const old of own.slice(0, Math.max(0, own.length - MAX_DEVICES_PER_PERSON))) this.devices.delete(old.token);
    this.write();
    return true;
  }

  /** Forget a phone (sign-out, or APNs said the token is gone). */
  remove(token: string): void {
    if (this.devices.delete(token.toLowerCase())) this.write();
  }

  /** This person's phones whose session is still live. Dead sessions are dropped. */
  forPerson(person: string, isLive: (sessionId: string) => boolean): PushDevice[] {
    const out: PushDevice[] = [];
    let dropped = false;
    for (const device of this.devices.values()) {
      if (device.person !== person) continue;
      if (!isLive(device.sessionId)) {
        this.devices.delete(device.token);
        dropped = true;
        continue;
      }
      out.push(device);
    }
    if (dropped) this.write();
    return out;
  }

  private write(): void {
    writeFileAtomic(this.file, JSON.stringify([...this.devices.values()]) + "\n", { mode: 0o600 });
  }
}

function valid(entry: unknown): PushDevice | null {
  if (!entry || typeof entry !== "object") return null;
  const { token, person, sessionId, environment, topic, updatedAt } = entry as Record<string, unknown>;
  if (typeof token !== "string" || !TOKEN.test(token)) return null;
  if (typeof person !== "string" || !KEY.test(person)) return null;
  if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200) return null;
  if (environment !== "production" && environment !== "sandbox") return null;
  if (typeof topic !== "string" || !TOPIC.test(topic)) return null;
  return { token, person, sessionId, environment, topic, updatedAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0 };
}
