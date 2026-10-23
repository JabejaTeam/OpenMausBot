// Fork: a code agent never asks the person. Its envelope tells it to end its
// reply with the question for its requester, and a NEEDS INPUT line it still
// writes does not park the work on the person: the assignment completes and
// the requester (the Manager) is resumed with the question in the report.
// Every other teammate keeps upstream's park on the person.
import { describe, expect, it } from "vitest";

import type { ComposedTurn, CoordinatorHost, HandoffView, HostTurnResult, RoomAddress } from "./coordinator.ts";
import { asksItsRequester, kindAsksRequester } from "./kind-instructions.ts";
import { RuntimeCoordinator } from "./runtime-coordinator.ts";
import { composeEnvelope } from "./runtime/envelope.ts";
import type { Assignment, EnvelopeNames } from "./runtime/types.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function world(asker: string) {
  const runs: Array<{ node: HandoffView; resumed: boolean; composed: ComposedTurn }> = [];
  const parks: string[] = [];
  const replies: Record<string, string> = {};
  const host: CoordinatorHost = {
    validate: () => undefined,
    busy: () => false,
    run(node, resumed, _signal, composed): Promise<HostTurnResult> {
      runs.push({ node, resumed, composed });
      return Promise.resolve({ ok: true, text: replies[node.botId] ?? `${node.botId} done` });
    },
    park: (_node, question) => { parks.push(question); },
    report: () => {},
    changed: () => {},
    names: (node, parent) => ({ requester: parent?.botId ?? "Wiebren", assignee: node.botId, person: "Wiebren",
      ...(parent && node.botId === asker ? { asksRequester: true } : {}) }),
    levelOf: () => ({ level: "auto" }),
    chiefOf: () => false,
  };
  const coordinator = new RuntimeCoordinator({ dataDir: ":memory:", host, log: () => {} });
  return { coordinator, runs, parks, replies };
}

const manager: RoomAddress = { botId: "manager", threadId: "manager-chat" };
const code: RoomAddress = { botId: "code", threadId: "code-work" };

async function askOnce(asker: string) {
  const w = world(asker);
  w.replies.code = "Looked at the repos.\nNEEDS INPUT: Where is the source of media.huppa.be?";
  w.coordinator.beginTurn({ id: "gen-1", address: manager, brief: "Update Next.js", level: "auto", origin: { kind: "user", request: "Update Next.js" } });
  const { node } = w.coordinator.enqueue(manager, "gen-1", undefined, code, "Find the projects", { approvalGranted: false, rework: false });
  w.coordinator.endTurn("gen-1", { ok: true, text: "" });
  for (let i = 0; i < 5; i++) { w.coordinator.tick(); await flush(); }
  return { w, child: w.coordinator.node(node.id) };
}

describe("fork: code agents ask their requester, never the person", () => {
  it("only code agents ask their requester", () => {
    expect(kindAsksRequester("code")).toBe(true);
    for (const kind of ["pm", "test", "work", undefined] as const) expect(kindAsksRequester(kind as never)).toBe(false);
  });

  it("a Manager or a Chief (Jarvis) is asked by every teammate; others only by a code agent", () => {
    expect(asksItsRequester("pm", { kind: "pm" })).toBe(true);
    expect(asksItsRequester("pm", { chiefOfStaff: true })).toBe(true);
    expect(asksItsRequester("code", {})).toBe(true);
    expect(asksItsRequester(undefined, {})).toBe(false);
    expect(asksItsRequester("pm", undefined)).toBe(false);
  });

  it("the envelope sends the question to the requester and drops the NEEDS INPUT route", () => {
    const a = { id: "as_1", rootId: "r", parentId: "r", depth: 1, origin: { kind: "person", source: "chat", ref: "t", quote: "Update Next.js" },
      requester: { kind: "bot_turn", botId: "manager", threadId: "t" }, assignee: { botId: "code", destination: { kind: "work_thread", threadId: "w" } },
      mode: "work", reply: "resume", brief: "Find the projects", status: "queued", level: "auto", levelSource: "own", executions: 0, restarts: 0,
      createdAt: 0, lastActivityAt: 0, result: "", rework: false, version: 1 } as Assignment;
    const names: EnvelopeNames = { requester: "Manager", assignee: "Code", person: "Wiebren" };
    const asking = composeEnvelope(a, { ...names, asksRequester: true });
    expect(asking).toContain("end your reply with the exact question for @Manager: it is resumed with your reply and answers you or asks Wiebren itself.");
    expect(asking).not.toContain("If something genuinely needs Wiebren");
    expect(composeEnvelope(a, names)).toContain("end your reply with `NEEDS INPUT:` and the exact question.");
    // a requester that is not resumed cannot answer: the person stays the route
    expect(composeEnvelope({ ...a, reply: "none" }, { ...names, asksRequester: true })).toContain("If something genuinely needs Wiebren");
  });

  it("a code agent's NEEDS INPUT completes the work and resumes the Manager with the question; no chip for the person", async () => {
    const { w, child } = await askOnce("code");
    expect(child).toMatchObject({ status: "completed" });
    expect(w.parks).toEqual([]);
    const resume = w.runs.find(r => r.node.botId === "manager" && r.resumed);
    expect(resume?.composed.text).toContain("Where is the source of media.huppa.be?");
  });

  it("another teammate still parks on the person (upstream)", async () => {
    const { w, child } = await askOnce("someone-else");
    expect(child).toMatchObject({ status: "waiting", question: "Where is the source of media.huppa.be?" });
    expect(w.parks).toEqual(["Where is the source of media.huppa.be?"]);
    expect(w.runs.some(r => r.node.botId === "manager" && r.resumed)).toBe(false);
  });
});
