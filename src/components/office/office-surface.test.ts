import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("office surfaces", () => {
  it("never blur what lies under them (office-surface.ts)", () => {
    const blurred = readdirSync(__dirname)
      .filter((name) => /\.tsx$/.test(name))
      .filter((name) => /backdrop-(blur|filter)/.test(readFileSync(join(__dirname, name), "utf8")));
    expect(blurred).toEqual([]);
  });
});
