import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { TurnRecovery } from "./turn-recovery.ts";
import { removeTempDir } from "./testing/cleanup.ts";

it("hands the turns running at a restart to the next server, at most twice in a row", async () => {
  const dir = mkdtempSync(join(tmpdir(), "turn-recovery-"));
  try {
    const file = join(dir, "running-turns.json");
    expect(new TurnRecovery(file).interrupted).toEqual([]);
    const first = new TurnRecovery(file);
    first.sync([{ botId: "pm", threadId: "t1" }, { botId: "books", threadId: "t2" }]);
    first.sync([{ botId: "pm", threadId: "t1" }]);
    // the server dies here
    const second = new TurnRecovery(file);
    expect(second.interrupted).toEqual([{ botId: "pm", threadId: "t1", recoveries: 0 }]);
    second.recovering(second.interrupted[0]);
    second.sync([]);
    second.sync([{ botId: "pm", threadId: "t1" }]);
    // dies again during the pick-up
    const third = new TurnRecovery(file);
    expect(third.interrupted).toEqual([{ botId: "pm", threadId: "t1", recoveries: 1 }]);
    third.recovering(third.interrupted[0]);
    third.sync([{ botId: "pm", threadId: "t1" }]);
    expect(new TurnRecovery(file).interrupted).toEqual([]);
    // a pick-up that finishes resets the count for the next turn there
    third.sync([]);
    third.sync([{ botId: "pm", threadId: "t1" }]);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([{ botId: "pm", threadId: "t1", recoveries: 0 }]);
  } finally { await removeTempDir(dir); }
});
