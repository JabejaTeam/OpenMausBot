import { describe, expect, it, vi } from "vitest";

import type { Bot, Group } from "@/state/store";
import type { SimpleGroup } from "@/lib/simple-ui-groups";

vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({}) }));

import { anyMemberWorking, botWorking } from "./SimpleSidebar";

const bot = (id: string, overrides: Partial<Bot> = {}): Bot => ({
  id, threadId: `thread-${id}`, name: id, title: "", description: "", notifications: true,
  color: "green", unread: false, modelSelection: { instanceId: "claude", model: "test" }, messages: [],
  ...overrides,
});
const team = (bots: Bot[]): SimpleGroup<Bot, Group> => ({ id: "section:Ripal", section: "Ripal", bots, rooms: [] });

describe("team row working state", () => {
  it("shows work when the Code agent works while the Manager only waits on it", () => {
    const manager = bot("pm", { waitingForTeammates: true, busy: false, activity: "idle" });
    const code = bot("code", { tasks: [{ threadId: "t-work", title: "Werk", createdAt: 1, busy: true, activity: "working" }] });
    expect(botWorking(manager, {})).toBe(false);
    expect(anyMemberWorking(team([manager, code]), {})).toBe(true);
  });

  it("stays quiet when no member works", () => {
    expect(anyMemberWorking(team([bot("pm"), bot("code")]), {})).toBe(false);
  });
});
