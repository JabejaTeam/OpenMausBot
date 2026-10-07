import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { withPointLightSkip } from "./light-range";

describe("withPointLightSkip", () => {
  const patched = withPointLightSkip(THREE.ShaderChunk.lights_fragment_begin);

  it("guards the point light term, and only that one", () => {
    expect(patched.match(/if \( directLight\.visible \) RE_Direct/g)).toHaveLength(1);
    const point = patched.indexOf("pointLight = pointLights[ i ];");
    const guard = patched.indexOf("if ( directLight.visible ) RE_Direct");
    const spot = patched.indexOf("spotLight = spotLights[ i ];");
    expect(guard).toBeGreaterThan(point);
    expect(guard).toBeLessThan(spot);
  });

  it("is applied once, however often it runs", () => {
    expect(withPointLightSkip(patched)).toBe(patched);
  });

  it("refuses a chunk it does not know (three.js upgrade)", () => {
    expect(() => withPointLightSkip("void main() {}")).toThrow(/changed/);
  });
});
