// Office view (fork): the office's light follows the real sky over Brussels —
// day, sunrise and sunset, blue hour, night — so it reads as a real office at
// this moment. Pure: give it a time, get the sun and the light to draw with.

export const BRUSSELS = { lat: 50.8503, lon: 4.3517 };

const RAD = Math.PI / 180;

/** Where the sun is (radians): altitude above the horizon, and azimuth
 * measured from south, positive towards the west (the SunCalc convention). */
export function sunPosition(date: Date, lat = BRUSSELS.lat, lon = BRUSSELS.lon): { altitude: number; azimuth: number } {
  const days = date.getTime() / 86_400_000 - 0.5 + 2_440_588 - 2_451_545;
  const meanAnomaly = RAD * (357.5291 + 0.98560028 * days);
  const center = RAD * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly));
  const eclipticLon = meanAnomaly + center + RAD * 102.9372 + Math.PI;
  const obliquity = RAD * 23.4397;
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(Math.sin(eclipticLon) * Math.cos(obliquity), Math.cos(eclipticLon));
  const sidereal = RAD * (280.16 + 360.9856235 * days) + lon * RAD;
  const hourAngle = sidereal - rightAscension;
  const phi = lat * RAD;
  return {
    altitude: Math.asin(Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle)),
    azimuth: Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi)),
  };
}

export type DaylightPhase = "night" | "blue-hour" | "golden-hour" | "day";

export interface Daylight {
  phase: DaylightPhase;
  /** degrees */
  altitude: number;
  /** radians, from south towards the west */
  azimuth: number;
  sunColor: string;
  sunIntensity: number;
  skyColor: string;
  groundColor: string;
  hemiIntensity: number;
  /** reflections from the room around (scene.environment) */
  envIntensity: number;
  /** desk lamps and the screens' glow: 0 by day, 1 at night */
  lamps: number;
  /** what the windows show */
  windowColor: string;
  /** around the building */
  background: string;
  exposure: number;
}

/** Light at a sun altitude (degrees), from night up to full day. Between two
 * stops every value blends, so the light never jumps from one minute to the
 * next. */
const STOPS: Array<{ at: number } & Omit<Daylight, "phase" | "altitude" | "azimuth">> = [
  { at: -12, sunColor: "#1b2340", sunIntensity: 0, skyColor: "#141a2e", groundColor: "#0b0d14", hemiIntensity: 0.35, envIntensity: 0.18, lamps: 1, windowColor: "#0d1426", background: "#07090f", exposure: 1.05 },
  { at: -6, sunColor: "#3a4a7a", sunIntensity: 0.1, skyColor: "#2a3558", groundColor: "#12141c", hemiIntensity: 0.55, envIntensity: 0.3, lamps: 0.85, windowColor: "#2b3a66", background: "#0d1220", exposure: 1.05 },
  { at: -1, sunColor: "#ff8a5c", sunIntensity: 0.6, skyColor: "#c98a7a", groundColor: "#2a2222", hemiIntensity: 0.8, envIntensity: 0.5, lamps: 0.5, windowColor: "#f0a07a", background: "#1c1820", exposure: 1 },
  { at: 6, sunColor: "#ffb375", sunIntensity: 1.5, skyColor: "#f3c9a0", groundColor: "#4a3e36", hemiIntensity: 0.8, envIntensity: 0.45, lamps: 0.1, windowColor: "#ffd6aa", background: "#2a2826", exposure: 0.95 },
  { at: 20, sunColor: "#fff1dc", sunIntensity: 2, skyColor: "#cfe2f5", groundColor: "#5c574f", hemiIntensity: 0.9, envIntensity: 0.5, lamps: 0, windowColor: "#e3eefa", background: "#2b2d31", exposure: 0.85 },
];

function mix(a: string, b: string, t: number): string {
  const ca = parseInt(a.slice(1), 16);
  const cb = parseInt(b.slice(1), 16);
  const channel = (shift: number) => Math.round(((ca >> shift) & 255) + ((((cb >> shift) & 255) - ((ca >> shift) & 255)) * t));
  return `#${((channel(16) << 16) | (channel(8) << 8) | channel(0)).toString(16).padStart(6, "0")}`;
}

export function daylightAt(altitudeDeg: number, azimuth = 0): Daylight {
  const last = STOPS.length - 1;
  const upper = STOPS.findIndex((stop) => stop.at >= altitudeDeg);
  // below the first stop: the first; above the last: the last; else blend two
  const [a, b] = upper === 0 ? [STOPS[0], STOPS[0]] : upper < 0 ? [STOPS[last], STOPS[last]] : [STOPS[upper - 1], STOPS[upper]];
  const span = b.at - a.at;
  const t = span > 0 ? Math.min(1, Math.max(0, (altitudeDeg - a.at) / span)) : 0;
  const num = (key: "sunIntensity" | "hemiIntensity" | "envIntensity" | "lamps" | "exposure") => a[key] + (b[key] - a[key]) * t;
  const col = (key: "sunColor" | "skyColor" | "groundColor" | "windowColor" | "background") => mix(a[key], b[key], t);
  const phase: DaylightPhase = altitudeDeg < -6 ? "night" : altitudeDeg < -1 ? "blue-hour" : altitudeDeg < 6 ? "golden-hour" : "day";
  return {
    phase,
    altitude: altitudeDeg,
    azimuth,
    sunColor: col("sunColor"),
    sunIntensity: num("sunIntensity"),
    skyColor: col("skyColor"),
    groundColor: col("groundColor"),
    hemiIntensity: num("hemiIntensity"),
    envIntensity: num("envIntensity"),
    lamps: num("lamps"),
    windowColor: col("windowColor"),
    background: col("background"),
    exposure: num("exposure"),
  };
}

/** The light in the office right now (or at `date`), as over Brussels. */
export function daylight(date: Date = new Date()): Daylight {
  const { altitude, azimuth } = sunPosition(date);
  return daylightAt(altitude / RAD, azimuth);
}
