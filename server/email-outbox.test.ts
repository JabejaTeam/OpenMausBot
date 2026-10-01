import { describe, expect, it } from "vitest";

import type { EmailCardData } from "../shared/wire.ts";
import {
  bodyWithSignature,
  callForCard,
  cardFromCall,
  cleanCardEdits,
  draftInstead,
  gmailIds,
  hasSignature,
  htmlToText,
  mailCallsInFrame,
  rewriteCall,
  signCall,
  withResultNote,
} from "./email-outbox.ts";

const SIGNATURE = '<div dir="ltr"><p>Wiebren Delhaye<br>Jabeja &amp; co</p><img src="https://x.test/logo.png"></div>';

const direct = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args },
});
const multi = (tools: Array<Record<string, unknown>>) => ({
  jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "COMPOSIO_MULTI_EXECUTE_TOOL", arguments: { tools } },
});

describe("finding outgoing Gmail in a relayed frame", () => {
  it("reads a direct call and a multi-execute entry, and leaves other frames alone", () => {
    expect(mailCallsInFrame(direct("GMAIL_SEND_EMAIL", { body: "hoi" })).calls.map((c) => c.tool)).toEqual(["GMAIL_SEND_EMAIL"]);
    const found = mailCallsInFrame(multi([
      { tool_slug: "GMAIL_FETCH_EMAILS", arguments: {} },
      { tool_slug: "GMAIL_CREATE_EMAIL_DRAFT", account: "work", arguments: { body: "x" } },
    ]));
    expect(found.calls).toMatchObject([{ tool: "GMAIL_CREATE_EMAIL_DRAFT", account: "work" }]);
    expect(found.others).toEqual(["GMAIL_FETCH_EMAILS"]);
    expect(mailCallsInFrame(direct("GMAIL_FETCH_EMAILS", {})).calls).toEqual([]);
    expect(mailCallsInFrame({ jsonrpc: "2.0", id: 1, method: "tools/list" }).calls).toEqual([]);
  });

  it("rewrites the frame itself, for direct and multi-execute calls", () => {
    const frame = direct("GMAIL_SEND_EMAIL", { recipient_email: "a@b.be", body: "hoi", from_email: "me@x.be" });
    const calls = mailCallsInFrame(frame);
    rewriteCall(calls, calls.calls[0]!, "GMAIL_CREATE_EMAIL_DRAFT", draftInstead("GMAIL_SEND_EMAIL", calls.calls[0]!.args));
    expect(frame.params).toEqual({ name: "GMAIL_CREATE_EMAIL_DRAFT", arguments: { recipient_email: "a@b.be", body: "hoi" } });

    const many = multi([{ tool_slug: "GMAIL_REPLY_TO_THREAD", arguments: { thread_id: "t1", recipient_email: "a@b.be", message_body: "ok" } }]);
    const inMany = mailCallsInFrame(many);
    rewriteCall(inMany, inMany.calls[0]!, "GMAIL_CREATE_EMAIL_DRAFT", draftInstead("GMAIL_REPLY_TO_THREAD", inMany.calls[0]!.args));
    expect(many.params.arguments.tools[0]).toEqual({
      tool_slug: "GMAIL_CREATE_EMAIL_DRAFT",
      arguments: { recipient_email: "a@b.be", body: "ok", thread_id: "t1" },
    });
  });
});

describe("the person's Gmail signature", () => {
  it("is appended as HTML, plain text converted, and never twice", () => {
    const frame = direct("GMAIL_SEND_EMAIL", { body: "Dag Bowie,\n\n<tot> morgen" });
    const call = mailCallsInFrame(frame).calls[0]!;
    expect(signCall(call, SIGNATURE)).toBe(true);
    expect(call.args.is_html).toBe(true);
    expect(call.args.body).toBe(`<div dir="ltr">Dag Bowie,<br><br>&lt;tot&gt; morgen</div><br><div dir="ltr" class="gmail_signature">${SIGNATURE}</div>`);
    expect(signCall(call, SIGNATURE)).toBe(false);
  });

  it("is skipped when the bot already pasted it, even reformatted", () => {
    const pasted = `<p>Hallo</p><p>Wiebren   Delhaye</p><p>Jabeja &amp; co</p>`;
    expect(hasSignature(pasted, SIGNATURE)).toBe(true);
    expect(hasSignature("<p>Hallo</p>", SIGNATURE)).toBe(false);
    expect(hasSignature("anything", "")).toBe(false);
  });

  it("goes on a reply's message_body, and nowhere without a signature", () => {
    const call = mailCallsInFrame(direct("GMAIL_REPLY_TO_THREAD", { thread_id: "t", message_body: "<p>ok</p>", is_html: true })).calls[0]!;
    signCall(call, SIGNATURE);
    expect(call.args.message_body).toBe(bodyWithSignature("<p>ok</p>", true, SIGNATURE));
    const bare = mailCallsInFrame(direct("GMAIL_SEND_EMAIL", { body: "x" })).calls[0]!;
    expect(signCall(bare, "  ")).toBe(false);
    expect(bare.args).toEqual({ body: "x" });
  });
});

describe("the email card", () => {
  it("shows a bot's HTML mail as editable plain text with every recipient", () => {
    const call = mailCallsInFrame(direct("GMAIL_SEND_EMAIL", {
      to: "bowie@boa.be", extra_recipients: ["jan@boa.be"], cc: ["miguel@ripal.be"], subject: "Update",
      body: "<p>Dag allemaal,</p><p>Alles &amp; meer</p>", is_html: true,
    })).calls[0]!;
    expect(cardFromCall(call)).toEqual({
      to: ["bowie@boa.be", "jan@boa.be"], cc: ["miguel@ripal.be"], bcc: [], subject: "Update",
      body: "Dag allemaal,\n\nAlles & meer", requested: "send",
    });
    const draft = mailCallsInFrame(direct("GMAIL_CREATE_EMAIL_DRAFT", { recipient_email: "a@b.be", thread_id: "t9" })).calls[0]!;
    expect(cardFromCall(draft)).toMatchObject({ requested: "draft", replyThreadId: "t9" });
  });

  it("turns the person's choice into the right Gmail call", () => {
    const draft = { to: ["a@b.be", "c@d.be"], cc: [], bcc: ["e@f.be"], subject: "S", body: "B" };
    expect(callForCard(draft, "send")).toEqual({
      tool: "GMAIL_SEND_EMAIL",
      args: { recipient_email: "a@b.be", extra_recipients: ["c@d.be"], bcc: ["e@f.be"], subject: "S", body: "B", is_html: false, user_id: "me" },
    });
    expect(callForCard({ ...draft, replyThreadId: "t1" }, "send").tool).toBe("GMAIL_REPLY_TO_THREAD");
    expect(callForCard({ ...draft, replyThreadId: "t1" }, "draft")).toMatchObject({ tool: "GMAIL_CREATE_EMAIL_DRAFT", args: { thread_id: "t1" } });
  });

  it("checks the person's edits", () => {
    const card: EmailCardData = { to: ["a@b.be"], cc: [], bcc: [], subject: "S", body: "B", requested: "send", status: "editable" };
    expect(cleanCardEdits({ to: "", subject: "S" }, card)).toEqual({ error: "Add at least one recipient" });
    expect(cleanCardEdits({ to: "a@b.be, nope" }, card)).toEqual({ error: '"nope" is not an email address' });
    expect(cleanCardEdits({ to: ["Bowie <bowie@boa.be>"], cc: "x@y.be; z@y.be", body: "Nieuw" }, card)).toEqual({
      draft: { to: ["Bowie <bowie@boa.be>"], cc: ["x@y.be", "z@y.be"], bcc: [], subject: "S", body: "Nieuw" },
    });
  });
});

describe("relay helpers", () => {
  it("adds a note to plain and streamed results", () => {
    const json = new TextEncoder().encode(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } }));
    const noted = JSON.parse(new TextDecoder().decode(withResultNote(json, "DRAFT")));
    expect(noted.result.content.map((c: { text: string }) => c.text)).toEqual(["ok", "DRAFT"]);
    const sse = new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({ id: 1, result: { content: [] } })}\n\n`);
    expect(new TextDecoder().decode(withResultNote(sse, "DRAFT"))).toContain('"text":"DRAFT"');
  });

  it("reads Gmail ids and readable text", () => {
    expect(gmailIds("GMAIL_CREATE_EMAIL_DRAFT", { id: "r1", message: { id: "m1" } })).toEqual({ draftId: "r1", messageId: "m1" });
    expect(gmailIds("GMAIL_SEND_EMAIL", { response_data: { id: "m2" } })).toEqual({ messageId: "m2" });
    expect(htmlToText("<div>a&nbsp;b<br>c</div><style>x{}</style>&#39;")).toBe("a b\nc\n'");
  });
});
