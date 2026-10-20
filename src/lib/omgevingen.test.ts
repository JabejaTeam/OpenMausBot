import { afterEach, describe, expect, it, vi } from "vitest";

import { actieveOmgeving, omgevingPath, omgevingVan, onActieveOmgeving, openOmgevingen, registerOwners, setActieveOmgeving, setOmgevingenForTest, startOmgevingen } from "./omgevingen";

const BOTH = [{ naam: "jabeja", titel: "Jabeja" }, { naam: "ripal", titel: "Ripal" }];

function door(omgevingen: unknown[], overal?: unknown[]) {
  return vi.fn(async (path: string) => {
    const body = path === "/__voordeur/overal" ? { omgevingen: overal ?? [] } : { omgevingen };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const o = (naam: string, actief: boolean, ingelogd: boolean) => ({ naam, titel: naam.toUpperCase(), actief, ingelogd, basis: `/o/${naam}` });

afterEach(() => setOmgevingenForTest({}));

describe("which instance a request is for", () => {
  it("changes nothing with one instance", () => {
    expect(omgevingPath("/api/bots")).toBe("/api/bots");
    expect(omgevingPath("/api/bots", "ripal")).toBe("/api/bots");
  });

  it("names the instance outright, else the owner of what it names, else the active one", () => {
    setOmgevingenForTest({ open: BOTH, actief: "jabeja", owners: { b1: "ripal", t1: "ripal", g1: "ripal" } });
    expect(omgevingPath("/api/config", "ripal")).toBe("/o/ripal/api/config");
    expect(omgevingPath("/api/bots/b1/read")).toBe("/o/ripal/api/bots/b1/read");
    expect(omgevingPath("/api/groups/g1/read")).toBe("/o/ripal/api/groups/g1/read");
    expect(omgevingPath("/api/live/x?threadId=t1")).toBe("/o/ripal/api/live/x?threadId=t1");
    expect(omgevingPath("/api/chat", null, JSON.stringify({ botId: "b1", text: "hoi" }))).toBe("/o/ripal/api/chat");
    expect(omgevingPath("/api/bots/unknown")).toBe("/o/jabeja/api/bots/unknown");
    expect(omgevingPath("/api/config")).toBe("/o/jabeja/api/config");
    expect(omgevingPath("/pair")).toBe("/pair");
  });
});

it("an id two instances claim routes by neither: the active instance decides", () => {
  setOmgevingenForTest({ open: BOTH, actief: "jabeja" });
  registerOwners("ripal", ["b1", "b2"]);
  registerOwners("jabeja", ["b1"]);
  registerOwners("ripal", ["b1"]);
  expect(omgevingVan("b1")).toBeNull();
  expect(omgevingPath("/api/bots/b1/read")).toBe("/o/jabeja/api/bots/b1/read");
  expect(omgevingPath("/api/bots/b2/read")).toBe("/o/ripal/api/bots/b2/read");
});

describe("opening the instances behind the door", () => {
  it("opens every signed-in one, the door's current one first", async () => {
    await startOmgevingen(door([o("jabeja", false, true), o("ripal", true, true)]), { install: false });
    expect(openOmgevingen().map((x) => x.naam)).toEqual(["ripal", "jabeja"]);
    expect(actieveOmgeving()).toBe("ripal");
  });

  it("signs in on the others first when one is missing", async () => {
    const fetchImpl = door([o("ripal", true, true), o("jabeja", false, false)], [o("ripal", true, true), o("jabeja", false, true)]);
    await startOmgevingen(fetchImpl, { install: false });
    expect(fetchImpl).toHaveBeenCalledWith("/__voordeur/overal", expect.objectContaining({ method: "POST" }));
    expect(openOmgevingen().map((x) => x.naam)).toEqual(["ripal", "jabeja"]);
  });

  it("stays one plain server when only the door's current one is signed in, or there is no door", async () => {
    await startOmgevingen(door([o("jabeja", true, true), o("ripal", false, false)], []), { install: false });
    expect(openOmgevingen()).toEqual([]);
    await startOmgevingen(vi.fn(async () => new Response("<html>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch, { install: false });
    expect(openOmgevingen()).toEqual([]);
  });

  it("signed in on one that is not the door's current one: everything goes there", async () => {
    await startOmgevingen(door([o("jabeja", true, false), o("ripal", false, true)], [o("jabeja", true, false), o("ripal", false, true)]), { install: false });
    expect(openOmgevingen().map((x) => x.naam)).toEqual(["ripal"]);
    expect(omgevingPath("/api/bots")).toBe("/o/ripal/api/bots");
  });
});

it("switching tells whoever listens, once per change", () => {
  setOmgevingenForTest({ open: BOTH, actief: "jabeja" });
  const heard = vi.fn();
  const stop = onActieveOmgeving(heard);
  setActieveOmgeving("ripal");
  setActieveOmgeving("ripal");
  setActieveOmgeving("weg");
  stop();
  expect(heard).toHaveBeenCalledTimes(1);
  expect(actieveOmgeving()).toBe("ripal");
});
