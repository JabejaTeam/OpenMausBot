// Jabeja fork: one fixed sign-in code for App Store review.
//
// Apple's reviewer cannot receive our code mail, so the demo instance names
// one address and one 8-digit code in OMB_REVIEW_LOGIN ("address:code").
// For that address no mail is sent and only that code is accepted; every
// other address goes to the normal client. Unset, nothing changes. Only the
// demo instance sets it: the address still has to be on the sign-in list,
// and what it sees there is just the demo team.
import { timingSafeEqual } from "node:crypto";
import { ControlPlaneError, normalizeAccountEmail, type ControlPlaneClient } from "../electron/control-plane-client.mjs";

type CodeClient = Pick<ControlPlaneClient, "requestOTP" | "verifyOTP" | "signOut">;

export function reviewLoginFromEnv(env: NodeJS.ProcessEnv): { email: string; code: string } | null {
  const [rawEmail, code] = (env.OMB_REVIEW_LOGIN ?? "").split(":");
  const email = normalizeAccountEmail(rawEmail ?? "");
  return email && /^\d{8}$/.test(code ?? "") ? { email, code: code! } : null;
}

/** `base` undefined = no mail client here: other addresses then fail as unreachable. */
export function withReviewLogin(base: CodeClient | undefined, review: { email: string; code: string }): CodeClient {
  const other = (): CodeClient => {
    if (!base) throw new ControlPlaneError("mail_unreachable");
    return base;
  };
  return {
    async requestOTP(rawEmail) {
      return normalizeAccountEmail(rawEmail) === review.email ? { email: review.email } : other().requestOTP(rawEmail);
    },
    async verifyOTP(rawEmail, rawCode) {
      if (normalizeAccountEmail(rawEmail) !== review.email) return other().verifyOTP(rawEmail, rawCode);
      const code = typeof rawCode === "string" ? rawCode.replace(/[\s-]/g, "") : "";
      if (!/^\d{8}$/.test(code)) throw new ControlPlaneError("invalid_otp");
      if (!timingSafeEqual(Buffer.from(code), Buffer.from(review.code))) throw new ControlPlaneError("invalid_otp", 401);
      return { accountToken: "", user: { id: `local:${review.email}`, email: review.email } };
    },
    async signOut(token) {
      return base?.signOut(token);
    },
  };
}
