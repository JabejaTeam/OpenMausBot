import { describe, expect, it } from "vitest";
import { daylight, daylightAt, sunPosition } from "./office-daylight";

const deg = (rad: number) => (rad * 180) / Math.PI;

describe("sunPosition over Brussels", () => {
  it("stands high at a June noon and low at a December noon", () => {
    // solar noon in Brussels is ~13:44 CEST in June (11:44 UTC)
    expect(deg(sunPosition(new Date("2026-06-21T11:44:00Z")).altitude)).toBeCloseTo(62.7, 0);
    expect(deg(sunPosition(new Date("2026-12-21T11:44:00Z")).altitude)).toBeCloseTo(15.8, 0);
  });

  it("is on the horizon at sunrise and below it at midnight", () => {
    // sunrise in Brussels on 21 June 2026: 05:29 CEST (03:29 UTC)
    expect(Math.abs(deg(sunPosition(new Date("2026-06-21T03:29:00Z")).altitude))).toBeLessThan(1.5);
    expect(deg(sunPosition(new Date("2026-06-21T22:00:00Z")).altitude)).toBeLessThan(-10);
  });

  it("rises in the east and sets in the west", () => {
    // azimuth from south, westward positive: east is about -90°, west about +90°
    expect(deg(sunPosition(new Date("2026-03-20T06:30:00Z")).azimuth)).toBeLessThan(-70);
    expect(deg(sunPosition(new Date("2026-03-20T17:30:00Z")).azimuth)).toBeGreaterThan(70);
  });
});

describe("daylight", () => {
  it("names the phase of the sky", () => {
    expect(daylight(new Date("2026-06-21T11:44:00Z")).phase).toBe("day");
    expect(daylight(new Date("2026-06-21T03:35:00Z")).phase).toBe("golden-hour");
    expect(daylight(new Date("2026-06-21T20:15:00Z")).phase).toBe("blue-hour");
    expect(daylight(new Date("2026-06-21T23:30:00Z")).phase).toBe("night");
  });

  it("turns the lamps on at night and off by day", () => {
    expect(daylight(new Date("2026-06-21T23:30:00Z")).lamps).toBe(1);
    expect(daylight(new Date("2026-06-21T11:44:00Z")).lamps).toBe(0);
  });

  it("never jumps from one minute to the next, all day long", () => {
    const start = new Date("2026-10-04T00:00:00Z").getTime();
    let last = daylight(new Date(start));
    for (let minute = 1; minute < 24 * 60; minute += 1) {
      const now = daylight(new Date(start + minute * 60_000));
      expect(Math.abs(now.sunIntensity - last.sunIntensity)).toBeLessThan(0.08);
      expect(Math.abs(now.lamps - last.lamps)).toBeLessThan(0.05);
      expect(Math.abs(now.hemiIntensity - last.hemiIntensity)).toBeLessThan(0.05);
      last = now;
    }
  });

  it("holds the ends: deep night and high noon stay put", () => {
    expect(daylightAt(-40)).toMatchObject({ phase: "night", lamps: 1, sunIntensity: 0 });
    expect(daylightAt(70)).toMatchObject({ phase: "day", lamps: 0, sunIntensity: 2 });
  });
});
