import { describe, expect, it, vi } from "vitest";
import { createEmailSignIn } from "./account-signin.ts";
import { CODE_ATTEMPTS, CODE_TTL_MS, RESEND_AFTER_MS, createSesCodeClient, mailHtml, sesKeyFromEnv, signSes } from "./fork-signin-mail.ts";

const KEY = { accessKey: "AKIDEXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", sessionToken: "", region: "eu-north-1" };
const SES_URL = "https://email.eu-north-1.amazonaws.com/v2/email/outbound-emails";

function setup(code = "12345678") {
  let clock = 1_800_000_000_000;
  const sent: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    return new Response("{}", { status: 200 });
  });
  const client = createSesCodeClient({ key: KEY, publicUrl: () => "https://bots.example.test/", now: () => clock, fetchImpl: fetchImpl as unknown as typeof fetch, code: () => code });
  return { client, sent, fetchImpl, tick: (ms: number) => { clock += ms; } };
}

describe("SES signing (port of hermes-ops ui/ses.py)", () => {
  it("produces the same SigV4 signature as ses.py for the same request", () => {
    // Vector from ses.onderteken() with these exact inputs.
    const headers = signSes(KEY, SES_URL, '{"a":1}', new Date(Date.UTC(2026, 9, 13, 20, 0, 0)));
    expect(headers).toEqual({
      "content-type": "application/json",
      "x-amz-date": "20261013T200000Z",
      Authorization: "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20261013/eu-north-1/ses/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=c3a5236f27b30f6def106781f6c67e5b1e857f7be5b3f0e293b9b6b7e3d22b5d",
    });
  });

  it("is off without both keys", () => {
    expect(sesKeyFromEnv({ OMB_SES_ACCESS_KEY_ID: "AK" })).toBeNull();
    expect(sesKeyFromEnv({ OMB_SES_ACCESS_KEY_ID: "AK", OMB_SES_SECRET_ACCESS_KEY: "SK" })).toEqual({ accessKey: "AK", secretKey: "SK", sessionToken: "", region: "eu-north-1" });
  });
});

describe("the Hubigen code mail", () => {
  it("mails the code from Hubigen through SES, in text and in the house-style HTML", async () => {
    const { client, sent } = setup();
    await client.requestOTP("Person@Example.test");
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(SES_URL);
    expect(sent[0].headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    const { FromEmailAddress, Destination, Content } = sent[0].body;
    expect(FromEmailAddress).toBe("Hubigen <noreply@hubigen.com>");
    expect(Destination).toEqual({ ToAddresses: ["person@example.test"] });
    expect(Content.Simple.Subject.Data).toBe("Je inlogcode voor Hubigen");
    expect(Content.Simple.Body.Text.Data).toContain("    12345678");
    expect(Content.Simple.Body.Text.Charset).toBe("UTF-8");
    // Microsoft 365 quarantines the HTML version: text only.
    expect(Content.Simple.Body.Html).toBeUndefined();
    expect(Content.Simple.Body.Text.Data).not.toMatch(/OpenMaus/i);
  });

  it("escapes what it puts in the HTML", () => {
    expect(mailHtml("a <b>", "x <script>\n\n    <i>", "https://h.test")).not.toMatch(/<script>|<b>|<i>/);
  });

  it("does not mail the same address twice within the resend window", async () => {
    const { client, sent, tick } = setup();
    await client.requestOTP("p@example.test");
    tick(RESEND_AFTER_MS - 1);
    await client.requestOTP("p@example.test");
    expect(sent).toHaveLength(1);
    tick(1);
    await client.requestOTP("p@example.test");
    expect(sent).toHaveLength(2);
  });

  it("refuses to sign in when SES refuses the mail, without echoing SES's message", async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(new Response('{"message":"Email address is not verified: p@example.test"}', { status: 400 }));
    await expect(client.requestOTP("p@example.test")).rejects.toMatchObject({ code: "mail_failed" });
  });
});

describe("the code itself", () => {
  it("works once, for its own address only", async () => {
    const { client } = setup();
    await client.requestOTP("p@example.test");
    await expect(client.verifyOTP("other@example.test", "12345678")).rejects.toMatchObject({ code: "invalid_otp", status: 401 });
    await expect(client.verifyOTP("P@example.test", "1234-5678")).resolves.toEqual({ accountToken: "", user: { id: "local:p@example.test", email: "p@example.test" } });
    await expect(client.verifyOTP("p@example.test", "12345678")).rejects.toMatchObject({ status: 401 });
  });

  it("expires", async () => {
    const { client, tick } = setup();
    await client.requestOTP("p@example.test");
    tick(CODE_TTL_MS);
    await expect(client.verifyOTP("p@example.test", "12345678")).rejects.toMatchObject({ status: 401 });
  });

  it("dies after too many wrong guesses", async () => {
    const { client } = setup();
    await client.requestOTP("p@example.test");
    for (let i = 0; i < CODE_ATTEMPTS; i++) await expect(client.verifyOTP("p@example.test", "00000000")).rejects.toMatchObject({ status: 401 });
    await expect(client.verifyOTP("p@example.test", "12345678")).rejects.toMatchObject({ status: 401 });
  });

  it("refuses a malformed code before looking it up", async () => {
    const { client } = setup();
    await expect(client.verifyOTP("p@example.test", "1234")).rejects.toMatchObject({ code: "invalid_otp", status: 0 });
  });

  it("signs in through upstream's email sign-in with the allow-list still in charge", async () => {
    const { client } = setup();
    const signIn = createEmailSignIn({ allow: { admins: [], members: ["@example.test"] }, client });
    expect(await signIn.start("stranger@elsewhere.test")).toMatchObject({ ok: false, status: 403 });
    expect(await signIn.start("p@example.test")).toEqual({ ok: true });
    expect(await signIn.verify("p@example.test", "99999999")).toMatchObject({ ok: false, status: 401 });
    expect(await signIn.verify("p@example.test", "12345678")).toEqual({ ok: true, email: "p@example.test", userId: "local:p@example.test", scopes: ["client"] });
  });
});
