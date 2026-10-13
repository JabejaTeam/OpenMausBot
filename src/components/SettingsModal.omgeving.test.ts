// Jabeja fork: Settings → Account → Environment shows only for someone on the
// sign-in list of 2+ environments behind the front door.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { StoreProvider } from "@/state/store";
import type { Omgeving } from "@/lib/voordeur-omgevingen";

const fixture = vi.hoisted(() => ({ omgevingen: [] as Omgeving[], advanced: true, section: "omgeving" }));
vi.mock("@/lib/voordeur-omgevingen", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/voordeur-omgevingen")>(),
  useOmgevingen: () => fixture.omgevingen,
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => fixture.advanced, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: () => {} }));

beforeAll(() => {
  (globalThis as { window?: unknown }).window ??= {};
  (globalThis as { document?: unknown }).document ??= { documentElement: { dataset: {} } };
});
beforeEach(() => {
  fixture.advanced = true;
  setLocale("nl");
});

const TWEE: Omgeving[] = [
  { naam: "jabeja", titel: "Jabeja", actief: true, ingelogd: true },
  { naam: "ripal", titel: "Ripal", actief: false, ingelogd: false },
];

async function render(): Promise<string> {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(SettingsModal)));
}

describe("Settings → Omgeving", () => {
  it("hidden without a front door, and for someone in one environment", async () => {
    fixture.omgevingen = [];
    expect(await render()).not.toContain('data-settings-section="omgeving"');
    fixture.omgevingen = TWEE.slice(0, 1);
    expect(await render()).not.toContain('data-settings-section="omgeving"');
  });

  it("under Account for someone in two, listing both with the current one marked", async () => {
    fixture.omgevingen = TWEE;
    const html = await render();
    const account = html.slice(html.indexOf('data-settings-group="account"'));
    expect(account).toContain('data-settings-section="omgeving"');
    expect(account).toContain("Omgeving");
    // the store opens General; the section itself renders both rows
    const { OmgevingSection } = await import("./OmgevingSection");
    const section = renderToStaticMarkup(createElement(OmgevingSection, { omgevingen: TWEE }));
    expect(section).toContain('data-omgeving="jabeja"');
    expect(section).toContain("Huidig");
    expect(section).toContain('data-omgeving="ripal"');
    expect(section).toContain("Aanmelden");
  });

  it("Simple mode stacks it on the Account page", async () => {
    fixture.advanced = false;
    fixture.omgevingen = TWEE;
    const { simpleSettingsPages, SECTIONS } = await import("./SettingsModal");
    const account = simpleSettingsPages(SECTIONS, "omgeving").find((page) => page.id === "account");
    expect(account?.sections[0]).toBe("omgeving");
  });
});
