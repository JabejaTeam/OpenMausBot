import { afterEach, describe, expect, it } from "vitest";
import { setAdvancedAllowed } from "./advanced-access";
import { readAdvancedMode, setAdvancedMode } from "./interface-mode";
import { readSimpleUi, setSimpleUi } from "./simple-ui";

describe("advanced access (fork)", () => {
  afterEach(() => setAdvancedAllowed(true));

  it("keeps a non-admin in Simple whatever was chosen on this device", () => {
    setSimpleUi(false);
    setAdvancedMode(true);
    setAdvancedAllowed(false);
    expect(readAdvancedMode()).toBe(false);
    expect(readSimpleUi()).toBe(true);
  });

  it("lets an admin choose", () => {
    setAdvancedAllowed(true);
    setAdvancedMode(true);
    expect(readAdvancedMode()).toBe(true);
  });
});
