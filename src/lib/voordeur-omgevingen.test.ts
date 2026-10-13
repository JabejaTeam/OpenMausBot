import { describe, expect, it, vi } from "vitest";
import { canSwitchOmgeving, fetchOmgevingen, wisselOmgeving, type Omgeving } from "./voordeur-omgevingen";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const TWEE: Omgeving[] = [
  { naam: "jabeja", titel: "Jabeja", actief: true, ingelogd: true },
  { naam: "ripal", titel: "Ripal", actief: false, ingelogd: false },
];

describe("fetchOmgevingen", () => {
  it("reads the front door's list, same-origin", async () => {
    const fetchImpl = vi.fn(async () => json(200, { omgevingen: [...TWEE, { naam: 1 }] }));
    expect(await fetchOmgevingen(fetchImpl as unknown as typeof fetch)).toEqual(TWEE);
    expect(fetchImpl).toHaveBeenCalledWith("/__voordeur/omgevingen", expect.objectContaining({ credentials: "same-origin" }));
  });

  it("no front door (the server's own HTML page), 401 or a network error: empty", async () => {
    const html = vi.fn(async () => new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }));
    expect(await fetchOmgevingen(html as unknown as typeof fetch)).toEqual([]);
    expect(await fetchOmgevingen((async () => json(401, { error: "unauthorized" })) as unknown as typeof fetch)).toEqual([]);
    expect(await fetchOmgevingen((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch)).toEqual([]);
  });

  it("only two or more is something to switch between", () => {
    expect(canSwitchOmgeving([])).toBe(false);
    expect(canSwitchOmgeving(TWEE.slice(0, 1))).toBe(false);
    expect(canSwitchOmgeving(TWEE)).toBe(true);
  });
});

describe("wisselOmgeving", () => {
  it("posts the name as JSON and returns where to go", async () => {
    const fetchImpl = vi.fn(async () => json(200, { naam: "ripal", naar: "/pair?email=wiebren%40jabeja.be" }));
    expect(await wisselOmgeving("ripal", fetchImpl as unknown as typeof fetch)).toBe("/pair?email=wiebren%40jabeja.be");
    expect(fetchImpl).toHaveBeenCalledWith("/__voordeur/wissel", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ naam: "ripal" }),
      headers: expect.objectContaining({ "content-type": "application/json" }),
    }));
  });

  it("refused, or a target off this site: throws", async () => {
    await expect(wisselOmgeving("x", (async () => json(404, { error: "no such environment" })) as unknown as typeof fetch)).rejects.toThrow();
    await expect(wisselOmgeving("x", (async () => json(200, { naar: "https://elders.example" })) as unknown as typeof fetch)).rejects.toThrow();
  });
});
