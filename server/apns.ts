// Fork: deliver a `notify` notification to iPhones through Apple Push
// Notification service (token-based auth, HTTP/2). Configured by env:
//   OMB_APNS_KEY_PATH  the .p8 key (APNs "Keys" in the Apple developer account)
//   OMB_APNS_KEY_ID    its key id
//   OMB_APNS_TEAM_ID   the developer team id
// Without them pushes are off and nothing else changes.
import http2 from "node:http2";
import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";

import type { Notification } from "../shared/notification.ts";
import type { ApnsEnvironment, PushDevice } from "./push-devices.ts";

export interface ApnsConfig {
  key: KeyObject;
  keyId: string;
  teamId: string;
}

export function apnsConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const path = env.OMB_APNS_KEY_PATH?.trim();
  const keyId = env.OMB_APNS_KEY_ID?.trim();
  const teamId = env.OMB_APNS_TEAM_ID?.trim();
  if (!path || !keyId || !teamId) return null;
  try {
    return { key: createPrivateKey(readFileSync(path)), keyId, teamId };
  } catch (error) {
    console.warn(`apns: cannot read the key at OMB_APNS_KEY_PATH: ${(error as Error).message}`);
    return null;
  }
}

/** What a phone shows: the bot's notification, and where tapping it goes. */
export function apnsPayload(notification: Notification): Record<string, unknown> {
  return {
    aps: {
      alert: { title: notification.title, body: notification.body },
      sound: "default",
      "thread-id": notification.threadId,
    },
    botId: notification.botId,
    threadId: notification.threadId,
    kind: notification.kind,
  };
}

/** A silent push: the phone takes this conversation's notifications off its
 * lock screen (read at a desk meanwhile, server/push-gate.ts). */
export function apnsClearPayload(threadId: string): Record<string, unknown> {
  return { aps: { "content-available": 1 }, clearThreadId: threadId };
}

export type PushType = "alert" | "background";

const HOSTS: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};
/** Apple accepts a provider token for an hour; renew well before. */
const TOKEN_TTL_MS = 50 * 60 * 1000;

export type SendResult = { ok: true } | { ok: false; status: number; reason: string; gone: boolean };

export class ApnsSender {
  private jwt: { value: string; at: number } | null = null;
  private readonly sessions = new Map<ApnsEnvironment, http2.ClientHttp2Session>();

  private readonly config: ApnsConfig;

  constructor(config: ApnsConfig) {
    this.config = config;
  }

  async send(device: PushDevice, payload: Record<string, unknown>, type: PushType = "alert"): Promise<SendResult> {
    const session = this.session(device.environment);
    return await new Promise<SendResult>((resolve) => {
      const req = session.request({
        ":method": "POST",
        ":path": `/3/device/${device.token}`,
        authorization: `bearer ${this.token()}`,
        "apns-topic": device.topic,
        "apns-push-type": type,
        // Apple refuses priority 10 for a background push
        "apns-priority": type === "alert" ? "10" : "5",
      });
      let body = "";
      let status = 0;
      req.setEncoding("utf8");
      req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on("response", (headers) => { status = Number(headers[":status"] ?? 0); });
      req.on("data", (chunk: string) => { body += chunk; });
      req.on("end", () => {
        if (status === 200) return resolve({ ok: true });
        let reason = "";
        try { reason = String((JSON.parse(body) as { reason?: unknown }).reason ?? ""); } catch { /* empty body */ }
        resolve({ ok: false, status, reason, gone: status === 410 || reason === "BadDeviceToken" || reason === "Unregistered" || reason === "DeviceTokenNotForTopic" });
      });
      req.on("error", (error) => resolve({ ok: false, status: 0, reason: error.message, gone: false }));
      req.end(JSON.stringify(payload));
    });
  }

  close(): void {
    for (const session of this.sessions.values()) session.close();
    this.sessions.clear();
  }

  private session(environment: ApnsEnvironment): http2.ClientHttp2Session {
    const open = this.sessions.get(environment);
    if (open && !open.closed && !open.destroyed) return open;
    const session = http2.connect(HOSTS[environment]);
    session.on("error", () => this.sessions.delete(environment));
    session.on("close", () => this.sessions.delete(environment));
    session.unref();
    this.sessions.set(environment, session);
    return session;
  }

  private token(now = Date.now()): string {
    if (this.jwt && now - this.jwt.at < TOKEN_TTL_MS) return this.jwt.value;
    const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${b64({ alg: "ES256", kid: this.config.keyId })}.${b64({ iss: this.config.teamId, iat: Math.floor(now / 1000) })}`;
    const signature = createSign("SHA256").update(unsigned).sign({ key: this.config.key, dsaEncoding: "ieee-p1363" }).toString("base64url");
    this.jwt = { value: `${unsigned}.${signature}`, at: now };
    return this.jwt.value;
  }
}

interface PushDeps {
  sender: Pick<ApnsSender, "send"> | null;
  devices: { forPerson(person: string, isLive: (id: string) => boolean): PushDevice[]; remove(token: string): void };
  isLive(sessionId: string): boolean;
}

/** Push one notification to every live phone of its person; drop tokens
 * Apple says are gone. Never throws: a push is best-effort. */
export async function pushToPerson(deps: PushDeps, person: string | undefined, notification: Notification): Promise<number> {
  return await sendToPerson(deps, person, apnsPayload(notification), "alert");
}

/** Take a conversation's notifications off every phone of this person. */
export async function clearOnPhones(deps: PushDeps, person: string, threadId: string): Promise<number> {
  return await sendToPerson(deps, person, apnsClearPayload(threadId), "background");
}

async function sendToPerson(deps: PushDeps, person: string | undefined, payload: Record<string, unknown>, type: PushType): Promise<number> {
  if (!deps.sender || !person) return 0;
  let delivered = 0;
  for (const device of deps.devices.forPerson(person, deps.isLive)) {
    try {
      const result = await deps.sender.send(device, payload, type);
      if (result.ok) delivered += 1;
      else if (result.gone) deps.devices.remove(device.token);
      else console.warn(`apns: push failed (${result.status} ${result.reason})`);
    } catch (error) {
      console.warn(`apns: push failed (${(error as Error).message})`);
    }
  }
  return delivered;
}
