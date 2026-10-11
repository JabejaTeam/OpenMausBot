import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";

/** Fork: a Chief that follows up on work it already handed to a teammate, against an isolated scripted server. */
async function fixture(test: (f: any) => Promise<void>) {
  const session = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlOmb(args, { env: { OPENMAUSBOT_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  try {
    const chief = (await cli("new-bot", "--name", "Clive", "--section", "Leadership")).bot;
    const clerk = (await cli("new-bot", "--name", "Bookkeeper", "--section", "Finance")).bot;
    await api(`/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Finance"], acknowledgePeerScope: true }, "PATCH");
    const planPath = join(session.info.dataDir, "room-plan.json");
    const gate = join(session.info.dataDir, "clerk-gate");
    const plan: Record<string, any> = {};
    const save = () => writeFileSync(planPath, JSON.stringify(plan));
    const nodes = () => existsSync(join(session.info.dataDir, "room-handoffs.json")) ? JSON.parse(readFileSync(join(session.info.dataDir, "room-handoffs.json"), "utf8")) : [];
    const clerkNodes = () => nodes().filter((n: any) => n.botId === clerk.id);
    const evidence = () => existsSync(`${planPath}.evidence.jsonl`) ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    const chiefTurn = (index: number) => evidence().find((t: any) => t.botId === chief.id && t.turnIndex === index);
    const stepResponse = (index: number, step: number) => JSON.parse(chiefTurn(index).evidence.filter((e: any) => e.step)[step].response.result.content[0].text);
    const messages = async (threadId: string) => (await api(`/api/threads/${threadId}/messages`)).messages;
    const say = (text: string) => cli("send", "--bot", chief.id, "--task", chief.activeTaskId, "--text", text);
    const assign = { bot_ids: [clerk.id], message: "Book the Q3 supplier invoices" };
    /** The clerk is mid-turn on the first assignment, its process holding at the gate. */
    const clerkWorking = async () => {
      await expect.poll(() => clerkNodes()[0]?.status, { timeout: 15_000 }).toBe("running");
      await expect.poll(async () => (await messages(clerkNodes()[0].threadId)).some((m: any) => m.text?.includes("Collecting invoices")), { timeout: 15_000 }).toBe(true);
    };
    await test({ session, cli, api, chief, clerk, plan, save, gate, nodes, clerkNodes, evidence, chiefTurn, stepResponse, messages, say, assign, clerkWorking });
  } finally { await session.close(); }
}

it("steers a follow-up into the teammate's running turn instead of queueing it behind that work", () => fixture(async f => {
  f.plan[f.chief.id] = { turns: [
    { steps: [{ arguments: f.assign }], reply: "Asked the Bookkeeper" },
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Book USD invoices in EUR only" } }], reply: "Correction passed on" },
    { reply: "Q3 booked in EUR" },
  ] };
  f.plan[f.clerk.id] = { progress: "Collecting invoices", gateFile: f.gate, reply: "Booked Q3" };
  f.save();
  await f.say("Have the Bookkeeper book Q3");
  await f.clerkWorking();
  await f.say("Oh, everything in dollars must be booked in euro");
  await expect.poll(() => f.chiefTurn(1), { timeout: 15_000 }).toBeTruthy();
  const receipt = f.stepResponse(1, 0).receipts[0];
  expect(receipt).toMatchObject({ outcome: "injected" });
  expect(f.clerkNodes()).toHaveLength(1);
  writeFileSync(f.gate, "go");
  await expect.poll(() => f.clerkNodes()[0]?.status, { timeout: 15_000 }).toBe("completed");
  expect(f.clerkNodes()).toHaveLength(1);
  expect(f.clerkNodes()[0].result).toContain("Book USD invoices in EUR only");
  expect(f.clerkNodes()[0].corrections).toEqual(["Book USD invoices in EUR only"]);
  const thread = await f.messages(f.clerkNodes()[0].threadId);
  expect(thread.some((m: any) => m.role === "user" && m.steered && m.text.includes("Book USD invoices in EUR only"))).toBe(true);
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Q3 booked in EUR"), { timeout: 15_000 }).toBe(true);
}), 60_000);

it("queues a follow-up to finished work in the same thread", () => fixture(async f => {
  f.plan[f.chief.id] = { turns: [
    { steps: [{ arguments: f.assign }], reply: "Asked the Bookkeeper" },
    { reply: "Q3 is booked" },
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Rebook USD invoices in EUR" } }], reply: "Correction passed on" },
    { reply: "Rebooked in EUR" },
  ] };
  f.plan[f.clerk.id] = { turns: [
    { reply: "Booked Q3" },
    { reply: "Rebooked in EUR", expectContextIncludes: ["Rebook USD invoices in EUR"] },
  ] };
  f.save();
  await f.say("Have the Bookkeeper book Q3");
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Q3 is booked"), { timeout: 20_000 }).toBe(true);
  await f.say("Oh, the dollar ones must be in euro");
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Rebooked in EUR"), { timeout: 20_000 }).toBe(true);
  const [first, follow] = f.clerkNodes();
  expect(follow).toMatchObject({ threadId: first.threadId, status: "completed" });
}), 60_000);

it("continues a code agent's last work thread for the next assignment, with the one before in view", () => fixture(async f => {
  await f.api(`/api/bots/${f.clerk.id}`, { kind: "code" }, "PATCH");
  f.plan[f.chief.id] = { turns: [
    { steps: [{ arguments: f.assign }], reply: "Asked the Bookkeeper" },
    { reply: "Q3 is booked" },
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Rebook USD invoices in EUR" } }], reply: "Correction passed on" },
    { reply: "Rebooked in EUR" },
  ] };
  f.plan[f.clerk.id] = { turns: [
    { reply: "Booked Q3" },
    { reply: "Rebooked in EUR", expectContextIncludes: ["Rebook USD invoices in EUR"] },
  ] };
  f.save();
  await f.say("Have the Bookkeeper book Q3");
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Q3 is booked"), { timeout: 20_000 }).toBe(true);
  await f.say("Oh, the dollar ones must be in euro");
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Rebooked in EUR"), { timeout: 20_000 }).toBe(true);
  const [first, follow] = f.clerkNodes();
  expect(follow.status, JSON.stringify(follow)).toBe("completed");
  expect(follow.threadId).toBe(first.threadId);
}), 60_000);

it("starts a parallel assignment to a code agent in its own thread beside the one still running", () => fixture(async f => {
  await f.api(`/api/bots/${f.clerk.id}`, { kind: "code" }, "PATCH");
  f.plan[f.chief.id] = { turns: [
    { steps: [{ arguments: f.assign }], reply: "Asked the Bookkeeper" },
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Book the Q3 customer invoices", parallel: true } }], reply: "Second job started" },
    { reply: "Both booked" },
  ] };
  f.plan[f.clerk.id] = { progress: "Collecting invoices", gateFile: f.gate, reply: "Booked" };
  f.save();
  await f.say("Have the Bookkeeper book Q3 supplier invoices");
  await f.clerkWorking();
  await f.say("And the customer invoices too, at the same time");
  await expect.poll(() => f.chiefTurn(1), { timeout: 15_000 }).toBeTruthy();
  expect(f.stepResponse(1, 0).receipts[0]).toMatchObject({ outcome: "queued" });
  await expect.poll(() => f.clerkNodes().map((n: any) => n.status), { timeout: 15_000 }).toEqual(["running", "running"]);
  const [first, second] = f.clerkNodes();
  expect(second.threadId).not.toBe(first.threadId);
  expect(first.corrections ?? []).toEqual([]);
  writeFileSync(f.gate, "go");
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Both booked"), { timeout: 20_000 }).toBe(true);
}), 60_000);

it("resumes the sender with a parallel assignment's result while its sibling is still running", () => fixture(async f => {
  await f.api(`/api/bots/${f.clerk.id}`, { kind: "code" }, "PATCH");
  f.plan[f.chief.id] = { turns: [
    { steps: [{ arguments: f.assign }, { arguments: { bot_ids: [f.clerk.id], message: "Book the Q3 customer invoices", parallel: true } }], reply: "Two jobs started" },
    { reply: "Customer invoices are booked; supplier invoices still running", expectContextIncludes: ["Booked", "still running"] },
    { reply: "Both booked" },
  ] };
  f.plan[f.clerk.id] = { gateFile: f.gate, gateWhenIncludes: "supplier invoices", reply: "Booked" };
  f.save();
  await f.say("Have the Bookkeeper book Q3 supplier and customer invoices");
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Customer invoices are booked; supplier invoices still running"), { timeout: 20_000 }).toBe(true);
  const supplier = f.clerkNodes().find((n: any) => n.text.includes("supplier"));
  expect(supplier.status).toBe("running");
  writeFileSync(f.gate, "go");
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Both booked"), { timeout: 20_000 }).toBe(true);
}), 60_000);

it("gives a code agent one thread per card: another card runs beside it, a follow-up returns to its card", () => fixture(async f => {
  await f.api(`/api/bots/${f.clerk.id}`, { kind: "code" }, "PATCH");
  f.plan[f.chief.id] = { turns: [
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Kaart aaaa1111: book the Q3 supplier invoices" } }], reply: "Supplier job started" },
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Kaart bbbb2222: book the Q3 customer invoices" } }], reply: "Customer job started" },
    { reply: "One done" }, { reply: "Both done" },
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Kaart aaaa1111: also the credit notes" } }], reply: "Follow-up sent" },
    { reply: "Credit notes done" },
  ] };
  f.plan[f.clerk.id] = { progress: "Collecting invoices", gateFile: f.gate, gateWhenIncludes: "supplier", reply: "Booked" };
  f.save();
  await f.say("Book the supplier invoices (card aaaa1111)");
  await f.clerkWorking();
  await f.say("And the customer invoices (card bbbb2222)");
  // A different card is not queued behind the running one: both run at once, each in its own thread.
  await expect.poll(() => f.clerkNodes().map((n: any) => n.status), { timeout: 15_000 }).toEqual(["running", "completed"]);
  const [supplier, customer] = f.clerkNodes();
  expect(customer.threadId).not.toBe(supplier.threadId);
  writeFileSync(f.gate, "go");
  await expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === "Both done"), { timeout: 20_000 }).toBe(true);
  await f.say("Also the credit notes for card aaaa1111");
  await expect.poll(() => f.clerkNodes().length, { timeout: 20_000 }).toBe(3);
  // Back on its own card's thread, not the newest one.
  expect(f.clerkNodes()[2].threadId).toBe(supplier.threadId);
}), 60_000);

it("starts a parallel assignment on a card as a copy of that card's thread, and tells the card's thread what it did", () => fixture(async f => {
  await f.api(`/api/bots/${f.clerk.id}`, { kind: "code" }, "PATCH");
  f.plan[f.chief.id] = { turns: [
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Kaart aaaa1111: build the invoice list" } }], reply: "List started" },
    { reply: "List done" },
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Kaart aaaa1111: add a CSV export", parallel: true } }], reply: "Export started" },
    { reply: "Export done" },
    { steps: [{ arguments: { bot_ids: [f.clerk.id], message: "Kaart aaaa1111: sort the list by date" } }], reply: "Sort started" },
    { reply: "Sort done" },
  ] };
  f.plan[f.clerk.id] = { turns: [
    { reply: "Invoice list built in commit aaa111" },
    { reply: "CSV export built in commit bbb222" },
    { reply: "Sorted", expectContextIncludes: ["CSV export built in commit bbb222"] },
  ] };
  f.save();
  const done = (text: string) => expect.poll(async () => (await f.messages(f.chief.activeTaskId)).some((m: any) => m.text === text), { timeout: 20_000 }).toBe(true);
  await f.say("Build the invoice list (card aaaa1111)");
  await done("List done");
  await f.say("And a CSV export, in parallel");
  await done("Export done");
  const [list, exportJob] = f.clerkNodes();
  expect(exportJob.threadId).not.toBe(list.threadId);
  const turns = f.evidence().filter((t: any) => t.botId === f.clerk.id);
  // The copy resumed the card thread's own session under a new id.
  expect(turns[1]).toMatchObject({ forkSession: true, resume: turns[0].resume ?? expect.any(String) });
  expect(turns[1].threadId).toBe(exportJob.threadId);
  await f.say("Sort it by date");
  await done("Sort done");
  // The next assignment on the card continues the card's thread, which now knows what the copy did.
  expect(f.clerkNodes()[2].threadId).toBe(list.threadId);
}), 60_000);
