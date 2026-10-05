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
