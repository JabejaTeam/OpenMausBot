// @vitest-environment happy-dom
// Jabeja fork: the channel picker lists teammates by name. A thread whose
// person key has no person behind it any more (a removed account or device)
// named no one and showed up as "Someone", once per such key.
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import { setPeopleForTest } from "@/lib/people";
import { setThreadChannel } from "@/lib/thread-channel";

vi.mock("@/lib/cloud-guest", () => ({ usePrivateThreads: () => true }));
vi.mock("@/state/store", () => ({
  api: vi.fn(),
  useStore: () => ({
    state: {
      bots: [{
        id: "pm", tasks: [
          { threadId: "a", access: "team", person: "p_yren" },
          { threadId: "b", access: "team", person: "p_gone1" },
          { threadId: "c", access: "team", person: "p_gone2" },
        ],
      }],
    },
    dispatch: vi.fn(),
  }),
}));
import { ThreadChannelPicker } from "./ThreadChannel";

let host: HTMLDivElement;
let root: Root;
const labels = () => {
  flushSync(() => root.render(createElement(ThreadChannelPicker)));
  flushSync(() => host.querySelector<HTMLButtonElement>("[data-testid=thread-channel]")!.click());
  return [...host.querySelectorAll("[role=menuitemradio], [role=menuitem]")].map((item) => item.textContent);
};

beforeEach(() => {
  setLocale("en");
  setPeopleForTest({ me: "p_me", names: { p_yren: "Yren Delhaye" } });
  setThreadChannel("mine");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => { flushSync(() => root.unmount()); host.remove(); });

describe("ThreadChannelPicker", () => {
  it("lists only teammates it can name", () => {
    const shown = labels();
    expect(shown.some((label) => label?.includes("Yren Delhaye"))).toBe(true);
    expect(shown.some((label) => label?.includes("Someone"))).toBe(false);
  });

  it("keeps the channel you are on while its name is not known", () => {
    setThreadChannel("person:p_gone1");
    expect(labels().filter((label) => label?.includes("Someone"))).toHaveLength(1);
  });
});
