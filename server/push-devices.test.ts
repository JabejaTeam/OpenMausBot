import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { apnsPayload, pushToPerson, type SendResult } from "./apns.ts";
import { MAX_DEVICES_PER_PERSON, PushDevices, type PushDevice } from "./push-devices.ts";
import type { Notification } from "../shared/notification.ts";

const file = () => join(mkdtempSync(join(tmpdir(), "omb-push-")), "push-devices.json");
const token = (n: number) => n.toString(16).padStart(64, "0");
const device = (n: number, person = "p_ada", sessionId = "sess-1") =>
  ({ token: token(n), person, sessionId, environment: "production", topic: "be.jabeja.hubigen" });
const live = () => true;

const note: Notification = { kind: "done", botId: "bot-1", botName: "Ripal PM", threadId: "thread-a", title: "Ripal PM", body: "Klaar." };

describe("PushDevices", () => {
  it("keeps phones per person and refuses bad input", () => {
    const devices = new PushDevices(file());
    expect(devices.register(device(1))).toBe(true);
    expect(devices.register(device(2, "p_bob"))).toBe(true);
    expect(devices.register({ ...device(3), token: "nope" })).toBe(false);
    expect(devices.register({ ...device(3), environment: "staging" })).toBe(false);
    expect(devices.forPerson("p_ada", live).map((d) => d.token)).toEqual([token(1)]);
    expect(devices.forPerson("p_bob", live).map((d) => d.token)).toEqual([token(2)]);
  });

  it("moves a token to whoever registers it last (a phone changes hands)", () => {
    const devices = new PushDevices(file());
    devices.register(device(1, "p_ada"));
    devices.register(device(1, "p_bob", "sess-2"));
    expect(devices.forPerson("p_ada", live)).toEqual([]);
    expect(devices.forPerson("p_bob", live)).toHaveLength(1);
  });

  it("drops phones whose session ended", () => {
    const devices = new PushDevices(file());
    devices.register(device(1, "p_ada", "sess-dead"));
    devices.register(device(2, "p_ada", "sess-live"));
    expect(devices.forPerson("p_ada", (id) => id === "sess-live").map((d) => d.token)).toEqual([token(2)]);
    expect(devices.forPerson("p_ada", live).map((d) => d.token)).toEqual([token(2)]);
  });

  it("keeps at most a handful of phones per person, newest first kept", () => {
    const devices = new PushDevices(file());
    for (let n = 1; n <= MAX_DEVICES_PER_PERSON + 2; n++) devices.register(device(n));
    const kept = devices.forPerson("p_ada", live).map((d) => d.token);
    expect(kept).toHaveLength(MAX_DEVICES_PER_PERSON);
    expect(kept).not.toContain(token(1));
  });

  it("keeps its file private and survives a restart", () => {
    const path = file();
    new PushDevices(path).register(device(1));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(new PushDevices(path).forPerson("p_ada", live)).toHaveLength(1);
  });
});

describe("pushToPerson", () => {
  it("sends only to the frame's person and forgets tokens Apple says are gone", async () => {
    const devices = new PushDevices(file());
    devices.register(device(1, "p_ada"));
    devices.register(device(2, "p_ada", "sess-2"));
    devices.register(device(3, "p_bob"));
    const sent: string[] = [];
    const sender = {
      async send(d: PushDevice): Promise<SendResult> {
        sent.push(d.token);
        return d.token === token(2) ? { ok: false, status: 410, reason: "Unregistered", gone: true } : { ok: true };
      },
    };
    const delivered = await pushToPerson({ sender, devices, isLive: live }, "p_ada", note);
    expect(delivered).toBe(1);
    expect(sent.sort()).toEqual([token(1), token(2)]);
    expect(devices.forPerson("p_ada", live).map((d) => d.token)).toEqual([token(1)]);
  });

  it("does nothing without a person or without APNs configured", async () => {
    const devices = new PushDevices(file());
    devices.register(device(1));
    let calls = 0;
    const sender = { async send(): Promise<SendResult> { calls++; return { ok: true }; } };
    expect(await pushToPerson({ sender, devices, isLive: live }, undefined, note)).toBe(0);
    expect(await pushToPerson({ sender: null, devices, isLive: live }, "p_ada", note)).toBe(0);
    expect(calls).toBe(0);
  });

  it("puts the conversation in the payload so a tap opens it", () => {
    expect(apnsPayload(note)).toMatchObject({ aps: { alert: { title: "Ripal PM", body: "Klaar." }, "thread-id": "thread-a" }, botId: "bot-1", threadId: "thread-a" });
  });
});
