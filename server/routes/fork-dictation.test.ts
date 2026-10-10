import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { requiredScope } from "../request-auth.ts";
import { createForkDictationRoutes, mintSonioxToken } from "./fork-dictation.ts";
import { PASS, type RouteContext } from "./table.ts";

function call(route: ReturnType<typeof createForkDictationRoutes>, method: string, path: string) {
  const answers: Array<{ status: number; body: unknown }> = [];
  const ctx = {
    req: {},
    res: {} as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth: { kind: "loopback", scopes: [] },
    json: (_res: ServerResponse, status: number, body: unknown) => {
      answers.push({ status, body });
    },
    readBody: async () => ({}),
  } as unknown as RouteContext;
  return route(ctx).then((out) => ({ out, answer: answers[0] }));
}

const sonioxOk = (body: unknown = { api_key: "temp-key", expires_at: "2026-10-10T12:00:00Z" }) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe("fork dictation routes", () => {
  it("says whether Soniox is set up, without the key", async () => {
    const on = await call(createForkDictationRoutes({ sonioxKey: () => "sk-secret" }), "GET", "/api/dictation");
    expect(on.answer).toEqual({ status: 200, body: { soniox: true } });
    expect(JSON.stringify(on.answer.body)).not.toContain("sk-secret");
    const off = await call(createForkDictationRoutes({ sonioxKey: () => undefined }), "GET", "/api/dictation");
    expect(off.answer).toEqual({ status: 200, body: { soniox: false } });
  });

  it("mints a single-use websocket key and hands only that to the page", async () => {
    const fetch = sonioxOk();
    const { answer } = await call(createForkDictationRoutes({ sonioxKey: () => "sk-secret", fetch }), "POST", "/api/dictation/token");
    expect(answer).toEqual({ status: 200, body: { token: "temp-key", expiresAt: "2026-10-10T12:00:00Z" } });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.soniox.com/v1/auth/temporary-api-key");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-secret");
    expect(JSON.parse(String(init.body))).toMatchObject({ usage_type: "transcribe_websocket", expires_in_seconds: 60, single_use: true });
  });

  it("refuses a key when none is set up, and hides Soniox's error detail", async () => {
    const off = await call(createForkDictationRoutes({ sonioxKey: () => undefined }), "POST", "/api/dictation/token");
    expect(off.answer.status).toBe(404);
    const failing = vi.fn(async () => new Response("bad key sk-secret", { status: 401 })) as unknown as typeof fetch;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = await call(createForkDictationRoutes({ sonioxKey: () => "sk-secret", fetch: failing }), "POST", "/api/dictation/token");
    error.mockRestore();
    expect(broken.answer).toEqual({ status: 502, body: { error: "Soniox gave no key" } });
  });

  it("passes every other route on", async () => {
    const route = createForkDictationRoutes({ sonioxKey: () => "sk" });
    expect((await call(route, "GET", "/api/dictation/token")).out).toBe(PASS);
    expect((await call(route, "DELETE", "/api/dictation")).out).toBe(PASS);
    expect((await call(route, "GET", "/api/bots")).out).toBe(PASS);
  });

  it("is open to a signed-in client, nothing more", () => {
    expect(requiredScope("GET", "/api/dictation")).toBe("client");
    expect(requiredScope("POST", "/api/dictation/token")).toBe("client");
    expect(requiredScope("PUT", "/api/dictation")).toBe("admin");
  });

  it("rejects an answer without a key", async () => {
    await expect(mintSonioxToken("sk", sonioxOk({}))).rejects.toThrow(/without api_key/);
  });
});
