import { describe, expect, it, vi } from "vitest";
import { createEmailSignIn } from "./account-signin.ts";
import { reviewLoginFromEnv, withReviewLogin } from "./fork-review-login.ts";

const REVIEW = { email: "appreview@hubigen.com", code: "24681357" };
const allow = { admins: [], members: ["appreview@hubigen.com", "person@example.test"] };

function base() {
  return {
    requestOTP: vi.fn(async (email: string) => ({ email })),
    verifyOTP: vi.fn(async (email: string) => ({ accountToken: "", user: { id: `local:${email}`, email } })),
    signOut: vi.fn(async () => undefined),
  };
}

describe("App Store review sign-in", () => {
  it("reads address:code from the env, and nothing without a valid pair", () => {
    expect(reviewLoginFromEnv({ OMB_REVIEW_LOGIN: "AppReview@Hubigen.com:24681357" })).toEqual(REVIEW);
    expect(reviewLoginFromEnv({})).toBeNull();
    expect(reviewLoginFromEnv({ OMB_REVIEW_LOGIN: "appreview@hubigen.com:1234" })).toBeNull();
    expect(reviewLoginFromEnv({ OMB_REVIEW_LOGIN: "not-an-email:24681357" })).toBeNull();
  });

  it("signs the review address in with the fixed code, without mailing", async () => {
    const mail = base();
    const signIn = createEmailSignIn({ allow, client: withReviewLogin(mail, REVIEW) });
    expect(await signIn.start("AppReview@hubigen.com")).toEqual({ ok: true });
    expect(mail.requestOTP).not.toHaveBeenCalled();
    expect(await signIn.verify("appreview@hubigen.com", "2468 1357")).toMatchObject({ ok: true, email: "appreview@hubigen.com", scopes: expect.any(Array) });
    expect(await signIn.verify("appreview@hubigen.com", "24681357")).toMatchObject({ ok: true }); // reusable
    expect(mail.verifyOTP).not.toHaveBeenCalled();
  });

  it("refuses a wrong code for the review address", async () => {
    const signIn = createEmailSignIn({ allow, client: withReviewLogin(base(), REVIEW) });
    expect(await signIn.verify("appreview@hubigen.com", "11111111")).toMatchObject({ ok: false, status: 401 });
  });

  it("still needs the address on the sign-in list", async () => {
    const signIn = createEmailSignIn({ allow: { admins: [], members: [] }, client: withReviewLogin(base(), REVIEW) });
    expect(await signIn.start("appreview@hubigen.com")).toMatchObject({ ok: false, status: 403 });
    expect(await signIn.verify("appreview@hubigen.com", "24681357")).toMatchObject({ ok: false, status: 403 });
  });

  it("passes every other address to the normal client", async () => {
    const mail = base();
    const signIn = createEmailSignIn({ allow, client: withReviewLogin(mail, REVIEW) });
    await signIn.start("person@example.test");
    expect(mail.requestOTP).toHaveBeenCalledWith("person@example.test");
    expect(await signIn.verify("person@example.test", "24681357")).toMatchObject({ ok: true, email: "person@example.test" });
    expect(mail.verifyOTP).toHaveBeenCalled();
  });

  it("without a mail client, other addresses fail as unreachable", async () => {
    const signIn = createEmailSignIn({ allow, client: withReviewLogin(undefined, REVIEW) });
    expect(await signIn.start("person@example.test")).toMatchObject({ ok: false, status: 502 });
  });
});
