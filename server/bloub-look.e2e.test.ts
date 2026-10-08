// The drawn avatar's look (shared/bloub-look) travels through the paired-safe
// profile route: a complete known look is saved and published, an unknown id
// is refused and leaves the saved look alone.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("saves a valid bloub look through PATCH /api/bots/:id/profile and rejects an unknown id", async () => {
  const fixture = await launchVerificationServer({ ...process.env, FAKE_CLAUDE_MODE: "happy" });
  try {
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${fixture.info.url}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() as { bot: { bloub?: unknown }; error?: string } };
    };
    const { bot } = await runControlOmb(["new-bot", "--name", "Bloub fixture", "--url", fixture.info.url]) as { bot: { id: string } };
    const look = { shape: "goutte", expression: "fier", color: "violet" };

    const saved = await api("PATCH", `/api/bots/${bot.id}/profile`, { bloub: look });
    expect(saved.status).toBe(200);
    expect(saved.body.bot.bloub).toEqual(look);

    const refused = await api("PATCH", `/api/bots/${bot.id}/profile`, { bloub: { ...look, expression: "grumpy" } });
    expect(refused.status).toBe(400);
    expect(refused.body.error).toContain("bloub");

    const persisted = JSON.parse(readFileSync(join(fixture.info.dataDir, "bots.json"), "utf8"));
    expect(persisted.find((row: { id: string }) => row.id === bot.id).bloub).toEqual(look);
  } finally {
    await fixture.close();
  }
}, 60_000);
