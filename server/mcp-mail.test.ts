import { describe, expect, it } from "vitest";

import {
  argsWithEdits,
  cleanMcpEdits,
  MCP_CARD_ACTIONS,
  mailCard,
  mayLeaveUnattended,
  mcpMailSpecs,
  outgoingRule,
  parseMcpMailSpec,
  readMail,
} from "./mcp-mail.ts";
import { mailGateServer, withMailGates } from "./mcp-mail-mount.ts";
import { isHarnessOwnedMcpEnvName, parseMcpServerMutation, parseStoredMcpServer } from "./mcp-registry.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

const ms365 = { preset: "ms365" as const };
const odoo = { preset: "odoo" as const };

// The shapes the Softeria server takes, as models build them (Hermes saw
// all of these in the Ripal sessions).
const sendMail = {
  body: {
    Message: {
      subject: "Offerte 4711",
      body: { contentType: "HTML", content: "<p>Dag Jan,</p><p>In bijlage de offerte.</p>" },
      toRecipients: [{ emailAddress: { address: "Jan@Klant.be", name: "Jan" } }],
      attachments: [{ name: "offerte.pdf", contentBytes: "JVBERi0=" }],
    },
    SaveToSentItems: true,
  },
};
const reply = { messageId: "AAMk", body: { comment: "Dank je, we bekijken het." } };

describe("which calls send", () => {
  it("knows the Outlook tools by name, with - and _ alike", () => {
    for (const tool of ["send-mail", "send_mail", "reply-all-shared-mailbox-mail", "send-draft-message", "graph-batch", "forward-calendar-event"]) {
      expect(outgoingRule(ms365, tool, {}), tool).toBeDefined();
    }
    for (const tool of ["list-mail-messages", "create-draft-email", "create-reply-draft", "get-mail-message", "update-mail-message"]) {
      expect(outgoingRule(ms365, tool, {}), tool).toBeUndefined();
    }
  });

  it("holds a new event only when it invites someone, every change to an existing one, and a reply unless it stays quiet", () => {
    expect(outgoingRule(ms365, "create-calendar-event", { body: { subject: "Intern" } })).toBeUndefined();
    expect(outgoingRule(ms365, "create-calendar-event", { body: { attendees: [{ emailAddress: { address: "a@b.be" } }] } })).toBeDefined();
    // an existing meeting notifies the attendees it already has
    for (const tool of ["update-calendar-event", "update-specific-calendar-event", "delete-calendar-event", "cancel-calendar-event"]) {
      expect(outgoingRule(ms365, tool, { eventId: "1", body: { subject: "Verplaatst" } }), tool).toEqual({ editable: false });
    }
    expect(outgoingRule(ms365, "accept-calendar-event", { eventId: "1", body: {} })).toBeDefined();
    expect(outgoingRule(ms365, "decline-calendar-event", { eventId: "1", body: { sendResponse: false } })).toBeUndefined();
    // a sendResponse: false anywhere but the body Graph receives does not count
    expect(outgoingRule(ms365, "decline-calendar-event", { eventId: "1", note: { sendResponse: false }, body: { sendResponse: true } })).toBeDefined();
    expect(outgoingRule(ms365, "decline-calendar-event", { eventId: "1", sendResponse: false, body: {} })).toBeDefined();
  });

  it("lets an Odoo dry run pass and holds the commit, read the way Odoo reads it", () => {
    const message = { instance: "prod", model: "res.partner", record_id: 42, body: "Hallo", partner_ids: [42] };
    expect(outgoingRule(odoo, "odoo_send_message", message)).toBeUndefined();
    expect(outgoingRule(odoo, "odoo_send_message", { ...message, dry_run: true })).toBeUndefined();
    expect(outgoingRule(odoo, "odoo_send_message", { ...message, dry_run: false, confirmation_token: "t" })).toMatchObject({ editable: false });
    expect(outgoingRule(odoo, "odoo_send_message", { ...message, dry_run: 0 })).toBeDefined();
    expect(outgoingRule(odoo, "odoo_log_note", { ...message, dry_run: false })).toBeUndefined();
  });

  it("adds configured tools with wildcards", () => {
    const spec = { tools: ["notify_*", "send-invoice"] };
    expect(outgoingRule(spec, "notify-customer", {})).toEqual({ editable: false });
    expect(outgoingRule(spec, "send_invoice", {})).toBeDefined();
    expect(outgoingRule(spec, "send-mail", {})).toBeUndefined();
  });
});

describe("the config value", () => {
  it("takes a preset name or an object, and refuses anything else", () => {
    expect(parseMcpMailSpec("ms365")).toEqual({ ok: true, spec: { preset: "ms365" } });
    expect(parseMcpMailSpec({ preset: "odoo", unattendedTo: ["Hermien@ripal.be", "@ripal.be"] }))
      .toEqual({ ok: true, spec: { preset: "odoo", unattendedTo: ["hermien@ripal.be", "@ripal.be"] } });
    expect(parseMcpMailSpec("gmail").ok).toBe(false);
    expect(parseMcpMailSpec({}).ok).toBe(false);
    expect(parseMcpMailSpec({ preset: "ms365", always: true }).ok).toBe(false);
    expect(parseMcpMailSpec({ tools: ["rm -rf"] }).ok).toBe(false);
    expect(parseMcpMailSpec({ preset: "ms365", unattendedTo: ["not an address"] }).ok).toBe(false);
  });

  it("is validated with the server entry and survives an edit from the settings form", () => {
    const stored = parseStoredMcpServer("outlook", { command: "/opt/ms365-mcp/serve.sh", outbound: "ms365" });
    expect(stored).toMatchObject({ ok: true, server: { outbound: { preset: "ms365" } } });
    expect(parseStoredMcpServer("outlook", { command: "x", outbound: "nope" }).ok).toBe(false);
    if (!stored.ok) throw new Error("unreachable");
    const edited = parseMcpServerMutation("outlook", { command: "/opt/ms365-mcp/serve.sh", args: ["--org-mode"] }, stored.server);
    expect(edited).toMatchObject({ ok: true, server: { outbound: { preset: "ms365" }, args: ["--org-mode"] } });
    const remote = parseStoredMcpServer("odoo", { url: "https://odoo.example/mcp", outbound: { preset: "odoo" } });
    expect(remote).toMatchObject({ ok: true, server: { outbound: { preset: "odoo" } } });
    expect(mcpMailSpecs({ outlook: { command: "x", outbound: "ms365" }, odoo: { url: "u", outbound: "bad" }, other: { command: "y" } }))
      .toEqual({ outlook: { preset: "ms365" } });
  });
});

describe("reading the mail", () => {
  it("finds Graph's nested recipients, subject and HTML text", () => {
    expect(readMail(sendMail)).toEqual({
      to: ["jan@klant.be"], cc: [], bcc: [], subject: "Offerte 4711",
      text: "Dag Jan,\n\nIn bijlage de offerte.", uncertain: false,
    });
  });

  it("reads a reply's comment, and calls an Odoo partner id uncertain", () => {
    expect(readMail(reply)).toMatchObject({ to: [], text: "Dank je, we bekijken het.", uncertain: false });
    expect(readMail({ partner_ids: [42], body: "Hallo", subject: "Levering" })).toMatchObject({ to: ["#42"], subject: "Levering", text: "Hallo", uncertain: true });
  });
});

describe("leaving without a card", () => {
  const mail = readMail(sendMail);
  it("only happens in a routine whose mail may be sent; the approval mode is not an input", () => {
    expect(mayLeaveUnattended("send", ms365, mail)).toBe(true);
    for (const mode of ["compose", "draft", undefined] as const) expect(mayLeaveUnattended(mode, ms365, mail)).toBe(false);
    // Full access never reaches this decision: the gate runs below the engine.
    expect(mayLeaveUnattended.length).toBe(3);
  });

  it("with an allowlist, only to known addresses on it", () => {
    expect(mayLeaveUnattended("send", { ...ms365, unattendedTo: ["@klant.be"] }, mail)).toBe(true);
    expect(mayLeaveUnattended("send", { ...ms365, unattendedTo: ["jan@klant.be"] }, mail)).toBe(true);
    expect(mayLeaveUnattended("send", { ...ms365, unattendedTo: ["@ripal.be"] }, mail)).toBe(false);
    expect(mayLeaveUnattended("send", { ...ms365, unattendedTo: ["@klant.be"] }, readMail(reply))).toBe(false);
    expect(mayLeaveUnattended("send", { ...odoo, unattendedTo: ["@klant.be"] }, readMail({ partner_ids: [42] }))).toBe(false);
  });
});

describe("the card", () => {
  it("is the email card, editable for a plain mail, with send and discard only", () => {
    const card = mailCard({ server: "outlook", tool: "send-mail", args: sendMail, rule: outgoingRule(ms365, "send-mail", sendMail)!, requestId: "r1" });
    expect(card).toMatchObject({ to: ["jan@klant.be"], subject: "Offerte 4711", requested: "send", status: "editable", mcp: { server: "outlook", tool: "send-mail", requestId: "r1", editable: true } });
    expect(MCP_CARD_ACTIONS).toEqual(["send", "discard"]);
    expect(MCP_CARD_ACTIONS).not.toContain("always" as never);
  });

  it("is read-only with the raw request when the fields cannot be edited", () => {
    const batch = { body: { requests: [{ id: "1", method: "POST", url: "/me/sendMail", body: { message: { subject: "x" } } }] } };
    const card = mailCard({ server: "outlook", tool: "graph-batch", args: batch, rule: outgoingRule(ms365, "graph-batch", batch)!, requestId: "r2" });
    expect(card.mcp).toMatchObject({ editable: false });
    expect(card.mcp!.raw).toContain("/me/sendMail");
    const odooCard = mailCard({ server: "odoo", tool: "odoo_send_message", args: { partner_ids: [42], body: "Hallo", dry_run: false }, rule: { editable: true }, requestId: "r3" });
    expect(odooCard.mcp!.editable).toBe(false);
    expect(cleanMcpEdits({ to: "evil@x.be", body: "changed" }, odooCard)).toEqual({ draft: { to: ["#42"], cc: [], bcc: [], subject: "", body: "Hallo" } });
  });

  it("checks the person's edits", () => {
    const card = mailCard({ server: "outlook", tool: "send-mail", args: sendMail, rule: { editable: true }, requestId: "r1" });
    expect(cleanMcpEdits({ to: "" }, card)).toEqual({ error: "Add at least one recipient" });
    expect(cleanMcpEdits({ to: "jan@klant.be", cc: "nope" }, card)).toEqual({ error: '"nope" is not an email address' });
    const replyCard = mailCard({ server: "outlook", tool: "reply-mail-message", args: reply, rule: { editable: true }, requestId: "r4" });
    expect(cleanMcpEdits({ to: "", body: "Graag gedaan." }, replyCard)).toMatchObject({ draft: { to: [], body: "Graag gedaan." } });
  });
});

describe("writing the edits back", () => {
  const before = mailCard({ server: "outlook", tool: "send-mail", args: sendMail, rule: { editable: true }, requestId: "r" });

  it("changes only what the person changed, in the shape it came in", () => {
    expect(argsWithEdits(sendMail, before, before)).toEqual(sendMail);
    const next = argsWithEdits(sendMail, before, { ...before, to: ["piet@klant.be"], cc: ["boss@klant.be"], body: "Dag Piet,\nzie bijlage." }) as typeof sendMail & { body: { Message: Record<string, unknown> } };
    expect(next.body.Message.toRecipients).toEqual([{ emailAddress: { address: "piet@klant.be" } }]);
    expect(next.body.Message.ccRecipients).toEqual([{ emailAddress: { address: "boss@klant.be" } }]);
    expect(next.body.Message.body).toEqual({ contentType: "HTML", content: '<div dir="ltr">Dag Piet,<br>zie bijlage.</div>' });
    expect(next.body.Message.subject).toBe("Offerte 4711");
    expect(next.body.Message.attachments).toEqual(sendMail.body.Message.attachments);
    expect(next.body.SaveToSentItems).toBe(true);
    // the original arguments are never touched
    expect(sendMail.body.Message.toRecipients[0]!.emailAddress.address).toBe("Jan@Klant.be");
  });

  it("writes a reply's comment as plain text", () => {
    const card = mailCard({ server: "outlook", tool: "reply-mail-message", args: reply, rule: { editable: true }, requestId: "r" });
    expect(argsWithEdits(reply, card, { ...card, body: "Prima, tot morgen." })).toEqual({ messageId: "AAMk", body: { comment: "Prima, tot morgen." } });
  });
});

describe("mounting the gate", () => {
  it("wraps a server behind the mail gate, credentials in a private env record, never on argv", () => {
    const gated = mailGateServer({
      name: "outlook",
      server: { command: "/opt/ms365-mcp/serve.sh", args: ["--org-mode"], env: { MS365_SECRET: "s3cret" } },
      spec: ms365, url: "http://127.0.0.1:8799", token: "bearer-1",
    })!;
    expect(gated.args[0]).toBe(SPAWNED_PROXIES.mcpMail);
    expect(gated.args[1]).toBe("--config-env");
    expect(gated.args[2]).toMatch(/^OPENMAUSBOT_MAIL_GATE_[a-f0-9]{64}$/);
    expect(JSON.stringify(gated.args)).not.toContain("s3cret");
    // Codex refuses a custom server whose environment names a harness variable.
    expect(Object.keys(gated.env).filter(isHarnessOwnedMcpEnvName)).toEqual([]);
    expect(JSON.parse(gated.env[gated.args[2]!]!)).toMatchObject({
      name: "outlook", spec: ms365, url: "http://127.0.0.1:8799", token: "bearer-1",
      upstream: { command: "/opt/ms365-mcp/serve.sh", args: ["--org-mode"], env: { MS365_SECRET: "s3cret" } },
    });
  });

  it("gates only servers with an outbound setting, and mints the bearer only then", () => {
    let minted = 0;
    const connection = () => { minted += 1; return { url: "http://127.0.0.1:1", token: "t" }; };
    const servers = { notes: { command: "notes" , args: [], env: {} }, odoo: { type: "http" as const, url: "https://odoo.example/mcp", headers: { Authorization: "Bearer x" } } };
    expect(withMailGates(servers, {}, connection)).toBe(servers);
    expect(minted).toBe(0);
    const out = withMailGates(servers, { odoo }, connection);
    expect(minted).toBe(1);
    expect(out.notes).toBe(servers.notes);
    expect(out.odoo).toMatchObject({ args: [SPAWNED_PROXIES.mcpMail, "--config-env", expect.stringMatching(/^OPENMAUSBOT_MAIL_GATE_/)] });
  });
});
