// Office view (fork): a point light costs nothing where it cannot reach.
// three.js shades every fragment with every point light, even beyond the
// light's `distance`, where getDistanceAttenuation is exactly 0 and so is the
// whole RE_Direct term. The office has a lamp per room (15+): by night that
// was ~40% of a frame's GPU time. This skips the term when the light is zero —
// the same pixels, bit for bit. Applied before any shader compiles.
import * as THREE from "three";

const POINT_LOOP = "pointLight = pointLights[ i ];";
const CALL = "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
const GUARD = "if ( directLight.visible ) ";

/** `lights_fragment_begin` with the point light term guarded. Throws when
 * three.js changed the chunk (an upgrade): look again rather than silently
 * lose the skip. */
export function withPointLightSkip(chunk: string): string {
  const loop = chunk.indexOf(POINT_LOOP);
  const call = loop < 0 ? -1 : chunk.indexOf(CALL, loop);
  if (call < 0) throw new Error("light-range: three.js lights_fragment_begin changed; update the point light skip");
  if (chunk.slice(call - GUARD.length, call) === GUARD) return chunk;
  return chunk.slice(0, call) + GUARD + chunk.slice(call);
}

/** Once per page, before the office's first shader compiles. */
export function skipUnreachedPointLights(): void {
  THREE.ShaderChunk.lights_fragment_begin = withPointLightSkip(THREE.ShaderChunk.lights_fragment_begin);
}
