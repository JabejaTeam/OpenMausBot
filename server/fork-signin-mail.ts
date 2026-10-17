// Jabeja fork: the emailed sign-in code comes from us, not from upstream.
//
// Upstream asks accounts.openmausbot.com for the code (server/account-signin.ts),
// so the mail says OpenMausBot and every address on our sign-in list passes
// through their service. With SES keys in the environment this client takes
// that place: it makes the code, keeps only its hash, and mails it through
// Amazon SES in the house style of chat.hubigen.com — a straight port of
// hermes-ops ui/mail.py + ui/ses.py (SigV4 over HTTPS, no SDK). Without keys
// nothing changes and upstream's control plane still sends the code.
//
// It plugs into createEmailSignIn's `client` seam, so the allow-list, the
// per-source lockout and the session that follows are upstream's, untouched.
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import product from "../shared/product.json" with { type: "json" };
import { ControlPlaneError, normalizeAccountEmail } from "../electron/control-plane-client.mjs";

/** How long a code works, how often it may be guessed, and how soon the
 * same address gets another mail (a second click resends nothing). */
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_ATTEMPTS = 5;
export const RESEND_AFTER_MS = 30_000;

const DEFAULT_REGION = "eu-north-1";
const TIMEOUT_MS = 15_000;

// The house style (hermes-ops ui/contract.py MAIL_*): white card, black ink,
// light only, so a client in dark mode cannot hide black text on its own black.
const BG = "#ffffff";
const INK = "#111111";
const SOFT = "#6b7280";
const LINE = "#e7e7e7";
const WIDTH = 560;
/** fork/rebrand.mjs copies fork/hubigen/wordmark-mail.png here: white baked in. */
export const WORDMARK_PATH = "/wordmark-mail.png";
const WORDMARK_W = 112;
const WORDMARK_H = 26;

export interface SesKey { accessKey: string; secretKey: string; sessionToken: string; region: string }

/** The SES keys, or null: then the code comes from upstream as before. Half a
 * key is null too — better off than a button that fails on a signature. */
export function sesKeyFromEnv(env: NodeJS.ProcessEnv): SesKey | null {
  const accessKey = env.OMB_SES_ACCESS_KEY_ID?.trim() ?? "";
  const secretKey = env.OMB_SES_SECRET_ACCESS_KEY?.trim() ?? "";
  if (!accessKey || !secretKey) return null;
  return { accessKey, secretKey, sessionToken: env.OMB_SES_SESSION_TOKEN?.trim() ?? "", region: env.OMB_SES_REGION?.trim() || DEFAULT_REGION };
}

const sha256hex = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest();

/** SigV4 headers for one SES POST (hermes-ops ui/ses.py `onderteken`). Pure. */
export function signSes(key: SesKey, url: string, body: string, now = new Date()): Record<string, string> {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = stamp.slice(0, 8);
  const { host, pathname } = new URL(url);
  const headers: Record<string, string> = { "content-type": "application/json", host, "x-amz-date": stamp };
  if (key.sessionToken) headers["x-amz-security-token"] = key.sessionToken;
  const names = Object.keys(headers).sort();
  const canonical = ["POST", pathname || "/", "", names.map((n) => `${n}:${headers[n].trim()}\n`).join(""), names.join(";"), sha256hex(body)].join("\n");
  const scope = `${day}/${key.region}/ses/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", stamp, scope, sha256hex(canonical)].join("\n");
  let signingKey = hmac(`AWS4${key.secretKey}`, day);
  for (const part of [key.region, "ses", "aws4_request"]) signingKey = hmac(signingKey, part);
  const signature = createHmac("sha256", signingKey).update(toSign, "utf8").digest("hex");
  const { host: _host, ...sent } = headers;
  return { ...sent, Authorization: `AWS4-HMAC-SHA256 Credential=${key.accessKey}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The code mail's text. The indented line is the code; html() frames it. */
export function codeMail(code: string): { subject: string; text: string } {
  return {
    subject: `Je inlogcode voor ${product.name}`,
    text: `Gebruik deze code om je aan te melden bij ${product.name}:

    ${code}

De code is tien minuten geldig en werkt één keer.

Heb je dit niet aangevraagd? Dan hoef je niets te doen; zonder de code kan
niemand aanmelden.
`,
  };
}

/** The whole mail around a text: brand, heading, paragraphs, footer. One card
 * on white, tables and inline styles only (hermes-ops ui/mail.py `html_van`). */
export function mailHtml(subject: string, text: string, publicUrl: string): string {
  const site = product.website.replace(/^https:\/\//, "");
  const blocks = text.trim().split("\n\n").map((block) => block.split("\n").filter((line) => line.trim()));
  const body = blocks.filter((lines) => lines.length).map((lines) => {
    const framed = lines.length === 1 ? /^ {4}(\S.*)$/.exec(lines[0]) : null;
    if (framed) {
      return `<tr><td style="padding:4px 0 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:separate;"><tr><td style="border:1px solid ${INK};border-radius:10px;padding:14px 16px;background:${BG};color:${INK};font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:26px;line-height:1.3;letter-spacing:0.18em;text-align:center;">${escapeHtml(framed[1])}</td></tr></table></td></tr>`;
    }
    return `<tr><td style="padding:0 0 16px;font-size:15px;line-height:1.65;color:${INK};">${lines.map((line) => escapeHtml(line.trim())).join(" ")}</td></tr>`;
  }).join("");
  const preview = escapeHtml(blocks[0]?.join(" ").trim() ?? "");
  const footer = `Je krijgt deze mail omdat iemand met dit adres wil aanmelden bij ${product.name}. Antwoorden op dit bericht komt bij niemand aan.`;
  return `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};color:${INK};-webkit-font-smoothing:antialiased;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${BG};font-size:1px;line-height:1px;">${preview}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BG};border-collapse:collapse;">
<tr><td align="center" style="padding:40px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${WIDTH}" style="width:100%;max-width:${WIDTH}px;background:${BG};border:1px solid ${LINE};border-radius:18px;border-collapse:separate;">
  <tr><td style="padding:32px 32px 0;">
    <img src="${escapeHtml(publicUrl.replace(/\/$/, "") + WORDMARK_PATH)}" width="${WORDMARK_W}" height="${WORDMARK_H}" alt="${escapeHtml(product.name)}" style="display:block;border:0;width:${WORDMARK_W}px;height:${WORDMARK_H}px;">
  </td></tr>
  <tr><td style="padding:26px 32px 0;">
    <h1 style="margin:0 0 18px;font-size:21px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:${INK};">${escapeHtml(subject)}</h1>
  </td></tr>
  <tr><td style="padding:0 32px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">${body}</table>
  </td></tr>
  <tr><td style="padding:8px 32px 0;">
    <div style="height:1px;background:${LINE};line-height:1px;font-size:1px;">&nbsp;</div>
  </td></tr>
  <tr><td style="padding:18px 32px 30px;font-size:12px;line-height:1.6;color:${SOFT};">
    ${escapeHtml(footer)}
  </td></tr>
  </table>
  <div style="max-width:${WIDTH}px;padding:16px 8px 0;font-size:12px;line-height:1.6;color:${SOFT};">
    ${escapeHtml(product.name)} &middot; <a href="${escapeHtml(product.website)}" style="color:${SOFT};text-decoration:underline;">${escapeHtml(site)}</a>
  </div>
</td></tr>
</table>
</body>
</html>
`;
}

/** The SendEmail body: Simple content, UTF-8 named, or "één" arrives as
 * mojibake. Plain text only: Microsoft 365 (Ripal, 17-10-2026) silently
 * quarantined every HTML version of the code mail, with or without the logo
 * and the hidden preview line, while the same text arrived. mailHtml stays for
 * when the sending domain is trusted there (SPF + own MAIL FROM). */
export function sesPayload(to: string, subject: string, text: string): string {
  return JSON.stringify({
    FromEmailAddress: product.mailFrom,
    Destination: { ToAddresses: [to] },
    Content: { Simple: {
      Subject: { Data: subject, Charset: "UTF-8" },
      Body: { Text: { Data: text, Charset: "UTF-8" } },
    } },
  });
}

type Pending = { hash: string; expiresAt: number; attempts: number; sentAt: number };

/** The part of upstream's control-plane client that email sign-in uses. */
export function createSesCodeClient(options: {
  key: SesKey;
  publicUrl: () => string;
  now?: () => number;
  fetchImpl?: typeof fetch;
  code?: () => string;
}) {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const makeCode = options.code ?? (() => String(randomInt(0, 100_000_000)).padStart(8, "0"));
  const pending = new Map<string, Pending>();
  const url = `https://email.${options.key.region}.amazonaws.com/v2/email/outbound-emails`;

  return {
    async requestOTP(rawEmail: string) {
      const email = normalizeAccountEmail(rawEmail);
      if (!email) throw new ControlPlaneError("invalid_email");
      const at = now();
      for (const [address, entry] of pending) if (entry.expiresAt <= at) pending.delete(address);
      const open = pending.get(email);
      if (open && at - open.sentAt < RESEND_AFTER_MS) return { email };
      const code = makeCode();
      const { subject, text } = codeMail(code);
      const body = sesPayload(email, subject, text);
      let response: Response;
      try {
        response = await fetchImpl(url, { method: "POST", headers: signSes(options.key, url, body), body, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new ControlPlaneError("mail_unreachable");
      }
      // SES's message can name the recipient or the key id: only the status
      // travels on. A 400 MessageRejected is nearly always the SES sandbox.
      if (!response.ok) throw new ControlPlaneError("mail_failed", response.status >= 500 ? 502 : 0);
      pending.set(email, { hash: createHash("sha256").update(code).digest("hex"), expiresAt: at + CODE_TTL_MS, attempts: 0, sentAt: at });
      return { email };
    },

    async verifyOTP(rawEmail: string, rawCode: string) {
      const email = normalizeAccountEmail(rawEmail);
      const code = typeof rawCode === "string" ? rawCode.replace(/[\s-]/g, "") : "";
      if (!email) throw new ControlPlaneError("invalid_email");
      if (!/^\d{8}$/.test(code)) throw new ControlPlaneError("invalid_otp");
      const entry = pending.get(email);
      if (!entry || entry.expiresAt <= now()) {
        pending.delete(email);
        throw new ControlPlaneError("invalid_otp", 401);
      }
      const given = Buffer.from(createHash("sha256").update(code).digest("hex"), "hex");
      if (!timingSafeEqual(given, Buffer.from(entry.hash, "hex"))) {
        if (++entry.attempts >= CODE_ATTEMPTS) pending.delete(email);
        throw new ControlPlaneError("invalid_otp", 401);
      }
      pending.delete(email); // single use
      return { accountToken: "", user: { id: `local:${email}`, email } };
    },

    async signOut() {},
  };
}
