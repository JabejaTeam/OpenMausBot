import { rmSync } from "node:fs";
import { beforeEach, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import { requiredScope } from "./request-auth.ts";
import { readTeamLooks, writeTeamLook } from "./team-looks.ts";

beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });
const png = "data:image/png;base64,iVBORw0KGgo=";

it("keeps a team's colour and logo, and clears them with null", () => {
  expect(writeTeamLook("section:Jabeja", { color: "#3b82f6", logo: png })).toMatchObject({ ok: true });
  expect(readTeamLooks()["section:Jabeja"]).toMatchObject({ color: "#3b82f6", logo: png });
  writeTeamLook("section:Jabeja", { logo: null });
  expect(readTeamLooks()["section:Jabeja"]).toMatchObject({ color: "#3b82f6" });
  expect(readTeamLooks()["section:Jabeja"].logo).toBeUndefined();
  writeTeamLook("section:Jabeja", { color: null });
  expect(readTeamLooks()["section:Jabeja"]).toBeUndefined();
});

it("keeps the name's text colour on its own, cleared with null", () => {
  writeTeamLook("section:Beautea", { textColor: "#ffffff" });
  expect(readTeamLooks()["section:Beautea"]).toMatchObject({ textColor: "#ffffff" });
  expect(writeTeamLook("section:Beautea", { textColor: "white" }).ok).toBe(false);
  writeTeamLook("section:Beautea", { textColor: null });
  expect(readTeamLooks()["section:Beautea"]).toBeUndefined();
});

it("refuses anything but a hex colour and a raster logo", () => {
  expect(writeTeamLook("section:Jabeja", { color: "red" }).ok).toBe(false);
  expect(writeTeamLook("section:Jabeja", { logo: "data:image/svg+xml;base64,PHN2Zz4=" }).ok).toBe(false);
  expect(writeTeamLook("section:Jabeja", { logo: "javascript:alert(1)" }).ok).toBe(false);
  expect(writeTeamLook("section:Jabeja", { color: "#123456", extra: 1 }).ok).toBe(false);
  expect(writeTeamLook("../etc", { color: "#123456" }).ok).toBe(false);
  expect(readTeamLooks()).toEqual({});
});

it("lets every member read the looks; only an admin changes them", () => {
  expect(requiredScope("GET", "/api/team-looks")).toBe("client");
  expect(requiredScope("PUT", "/api/team-looks/section%3AJabeja")).toBe("admin");
});
