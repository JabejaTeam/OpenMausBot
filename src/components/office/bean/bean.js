// Bean agent body: signed-distance shapes, smooth-unioned, meshed once with
// marching cubes and skinned onto RobotExpressive's skeleton, so every robot
// clip still drives it. All coordinates are the robot's rest pose (unscaled).
import * as THREE from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// ---------- SDF primitives (plain numbers, this runs a few million times) ----------
export const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const smax = (a, b, k) => -smin(-a, -b, k);

export function capsule(px, py, pz, a, b, r) {
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = Math.min(Math.max((pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz), 0), 1);
  const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
  return Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
}

/** Inigo Quilez' round cone between arbitrary points: radius r1 at a, r2 at b. */
export function roundCone(px, py, pz, a, b, r1, r2) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const l2 = bax * bax + bay * bay + baz * baz, rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1 / l2;
  const pax = px - a[0], pay = py - a[1], paz = pz - a[2];
  const y = pax * bax + pay * bay + paz * baz, z = y - l2;
  const xx = pax * l2 - bax * y, xy = pay * l2 - bay * y, xz = paz * l2 - baz * y;
  const x2 = xx * xx + xy * xy + xz * xz, y2 = y * y * l2, z2 = z * z * l2;
  const k = Math.sign(rr) * rr * rr * x2;
  if (Math.sign(z) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - r2;
  if (Math.sign(y) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - r1;
  return (Math.sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
}

function roundBox(px, py, pz, c, half, r) {
  const qx = Math.abs(px - c[0]) - half[0] + r, qy = Math.abs(py - c[1]) - half[1] + r, qz = Math.abs(pz - c[2]) - half[2] + r;
  const mx = Math.max(qx, 0), my = Math.max(qy, 0), mz = Math.max(qz, 0);
  return Math.sqrt(mx * mx + my * my + mz * mz) + Math.min(Math.max(qx, qy, qz), 0) - r;
}

// ---------- meshing ----------
/** Mesh an SDF over a cube (center, half size) and give it smooth SDF normals.
 *  With `simplify` (meshoptimizer's MeshoptSimplifier) the mesh is decimated to
 *  an absolute surface error first — the SDF normals keep the shading smooth. */
export function polygonize(sdf, center, half, res, { simplify = null, error = 0.004 } = {}) {
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 400000);
  mc.isolation = 0;
  const n = mc.size, field = mc.field;
  for (let z = 0; z < n; z++) {
    const wz = center[2] + ((z - n / 2) / (n / 2)) * half;
    for (let y = 0; y < n; y++) {
      const wy = center[1] + ((y - n / 2) / (n / 2)) * half;
      for (let x = 0; x < n; x++) {
        const wx = center[0] + ((x - n / 2) / (n / 2)) * half;
        field[x + y * n + z * n * n] = -sdf(wx, wy, wz);
      }
    }
  }
  mc.update();
  const src = mc.geometry.getAttribute("position").array;
  const pos = new Float32Array(mc.count * 3);
  for (let i = 0; i < mc.count * 3; i += 3) {
    pos[i] = center[0] + src[i] * half;
    pos[i + 1] = center[1] + src[i + 1] * half;
    pos[i + 2] = center[2] + src[i + 2] * half;
  }
  mc.geometry.dispose();
  let geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo = mergeVertices(geo, 1e-5);
  if (simplify) geo = decimate(geo, simplify, error);
  const p = geo.getAttribute("position"), nrm = new Float32Array(p.count * 3), e = 0.004;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const gx = sdf(x + e, y, z) - sdf(x - e, y, z), gy = sdf(x, y + e, z) - sdf(x, y - e, z), gz = sdf(x, y, z + e) - sdf(x, y, z - e);
    const l = Math.hypot(gx, gy, gz) || 1;
    nrm[i * 3] = gx / l; nrm[i * 3 + 1] = gy / l; nrm[i * 3 + 2] = gz / l;
  }
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  // marching cubes winding follows the field; make sure faces point along the normals
  const idx = geo.index.array, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  a.fromBufferAttribute(p, idx[0]); b.fromBufferAttribute(p, idx[1]); c.fromBufferAttribute(p, idx[2]);
  const face = b.sub(a).cross(c.sub(a));
  if (face.dot(new THREE.Vector3(nrm[idx[0] * 3], nrm[idx[0] * 3 + 1], nrm[idx[0] * 3 + 2])) < 0) {
    for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  }
  return geo;
}

function decimate(geo, S, error) {
  const src = geo.getAttribute("position").array;
  const [idx] = S.simplify(new Uint32Array(geo.index.array), src, 3, 0, error, ["ErrorAbsolute"]);
  const [remap, unique] = S.compactMesh(idx); // rewrites idx in place
  const pos = new Float32Array(unique * 3);
  for (let i = 0; i < remap.length; i++) if (remap[i] !== 0xffffffff) pos.set(src.subarray(i * 3, i * 3 + 3), remap[i] * 3);
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Body pieces carry `_part` = body so they merge with the face. */
function bodyMorphFree(geos) {
  for (const g of geos) g.setAttribute("_part", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(PART.body), 1));
}

/** Linear blend of bone-weight keyframes along a scalar (e.g. height). */
function ramp(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, w1] = keys[i];
    if (t <= t1) {
      const [t0, w0] = keys[i - 1], f = (t - t0) / (t1 - t0), out = {};
      for (const k in w0) out[k] = (out[k] ?? 0) + w0[k] * (1 - f);
      for (const k in w1) out[k] = (out[k] ?? 0) + w1[k] * f;
      return out;
    }
  }
  return keys[keys.length - 1][1];
}

/** Skin weights: each vertex belongs mostly to the primitive it lies on
 *  (soft-min over primitive distances), each primitive maps to bones. */
function skin(geo, parts, boneIndex, softness) {
  const p = geo.getAttribute("position"), si = new Uint16Array(p.count * 4), sw = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), acc = {};
    let total = 0;
    const ws = parts.map((part) => { const w = Math.exp(-Math.max(part.d(x, y, z), 0) / softness); total += w; return w; });
    parts.forEach((part, j) => {
      const bw = part.bones(x, y, z);
      for (const k in bw) acc[k] = (acc[k] ?? 0) + bw[k] * ws[j] / total;
    });
    const top = Object.entries(acc).sort((m, n) => n[1] - m[1]).slice(0, 4);
    const sum = top.reduce((s, [, w]) => s + w, 0);
    top.forEach(([name, w], k) => { si[i * 4 + k] = boneIndex[name]; sw[i * 4 + k] = w / sum; });
  }
  geo.setAttribute("skinIndex", new THREE.BufferAttribute(si, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(sw, 4));
}

// ---------- the agent ----------
/** Scale for the rest-pose units (robot 4.79 tall) so the bean matches the office robot's size. */
export const AGENT_SCALE = (3.2 / 4.79) * 1.25;

export const BODY = { center: [0, 2.25, 0], radius: 1.05, half: 0.5, squash: 0.9 }; // capsule 0.7 … 3.8

/** Bones the bean's skin uses; the robot's fingers and IK poles are not needed. */
export const BEAN_BONES = ["Hips", "Abdomen", "Torso_1", "Head", "UpperArmL", "LowerArmL", "UpperArmR", "LowerArmR", "UpperLegL", "LowerLegL", "FootL", "UpperLegR", "LowerLegR", "FootR"];

/** Builds the bean (body, legs, backpack, arms, visor, eyes) as ONE skinned mesh.
 *  opts.simplify/opts.error/opts.res: see polygonize (used when baking). */
export function buildBeanMeshes(bones, root, material, opts = {}) {
  const at = (name) => bones[name].getWorldPosition(new THREE.Vector3()).toArray();
  const boneList = BEAN_BONES.map((name) => bones[name]);
  const res = opts.res ?? 1;
  const boneIndex = Object.fromEntries(boneList.map((b, i) => [b.name, i]));
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(boneList);
  const L = (s, name) => `${name}${s}`;

  // body + legs + backpack — one smooth piece
  const bodyA = [0, BODY.center[1] - BODY.half, 0], bodyB = [0, BODY.center[1] + BODY.half, 0];
  const dBody = (x, y, z) => capsule(x, y, z / BODY.squash, bodyA, bodyB, BODY.radius) * 0.95;
  const dPack = (x, y, z) => roundBox(x, y, z, [0, 2.1, -0.88], [0.6, 0.72, 0.26], 0.22);
  const legs = ["L", "R"].map((s) => {
    const hip = at(L(s, "UpperLeg")), sx = Math.sign(hip[0]) * 0.6;
    const a = [sx, 1.25, -0.02], b = [sx * 1.02, 0.4, 0.05];
    return { s, d: (x, y, z) => smax(capsule(x, y, z, a, b, 0.42), 0.02 - y, 0.08) };
  });
  const bodySdf = (x, y, z) => {
    let d = smin(dBody(x, y, z), dPack(x, y, z), 0.14);
    for (const leg of legs) d = smin(d, leg.d(x, y, z), 0.24);
    return d;
  };
  const bodyGeo = polygonize(bodySdf, [0, 2.05, -0.05], 2.15, Math.round(150 * res), opts);
  skin(bodyGeo, [
    { d: dBody, bones: (x, y) => ramp([[1.4, { Hips: 1 }], [1.9, { Abdomen: 1 }], [2.4, { Torso_1: 1 }], [3.0, { Torso_1: 1 }], [3.8, { Torso_1: 0.4, Head: 0.6 }]], y) },
    { d: dPack, bones: () => ({ Torso_1: 1 }) },
    ...legs.map((leg) => ({
      d: leg.d,
      bones: (x, y) => ramp([[0, { [L(leg.s, "Foot")]: 1 }], [0.3, { [L(leg.s, "Foot")]: 0.7, [L(leg.s, "LowerLeg")]: 0.3 }], [0.75, { [L(leg.s, "LowerLeg")]: 1 }], [1.1, { [L(leg.s, "UpperLeg")]: 1 }], [1.4, { Hips: 1 }]], y),
    })),
  ], boneIndex, 0.06);

  const parts = [bodyGeo];

  // arms: thick round stubs, same language as the legs (bend at the elbow)
  for (const s of ["L", "R"]) {
    const S = at(L(s, "UpperArm")), E = at(L(s, "LowerArm")), P = at(L(s, "Palm2"));
    const tip = E.map((e, i) => e + (P[i] - e) * 0.4);
    const dUpper = (x, y, z) => capsule(x, y, z, S, E, 0.3);
    const dFore = (x, y, z) => capsule(x, y, z, E, tip, 0.3);
    const armSdf = (x, y, z) => smin(dUpper(x, y, z), dFore(x, y, z), 0.1);
    const pts = [S, E, tip], c = [0, 1, 2].map((i) => (Math.min(...pts.map((q) => q[i])) + Math.max(...pts.map((q) => q[i]))) / 2);
    const half = Math.max(...[0, 1, 2].map((i) => Math.max(...pts.map((q) => Math.abs(q[i] - c[i]))))) + 0.4;
    const geo = polygonize(armSdf, c, half, Math.round(110 * res), opts);
    skin(geo, [
      { d: dUpper, bones: () => ({ [L(s, "UpperArm")]: 1 }) },
      { d: dFore, bones: () => ({ [L(s, "LowerArm")]: 1 }) },
    ], boneIndex, 0.05);
    parts.push(geo);
  }
  // face rides on the Head bone inside the same mesh: one draw for the whole agent
  bodyMorphFree(parts);
  const face = faceGeometry(boneIndex.Head);
  const geo = mergeGeometries([...parts, ...face.geos]);
  const bodyCount = parts.reduce((n, g) => n + g.attributes.position.count, 0);
  geo.morphTargetsRelative = true;
  geo.morphAttributes.position = EYE_MORPHS.map((name) => {
    const delta = new Float32Array(geo.attributes.position.count * 3);
    let offset = bodyCount * 3;
    for (const chunk of face.morphs[name]) { delta.set(chunk, offset); offset += chunk.length; }
    const attr = new THREE.BufferAttribute(delta, 3);
    attr.name = name;
    return attr;
  });
  const m = new THREE.SkinnedMesh(geo, material);
  m.name = "Bean";
  m.updateMorphTargets();
  m.castShadow = m.receiveShadow = true;
  m.frustumCulled = false;
  root.add(m);
  m.bind(skeleton);
  return [m];
}

// ---------- face: visor + eyes, merged into the body mesh ----------
/** `_part` vertex attribute: which look a vertex gets (agent.js shades by it). */
export const PART = { body: 0, visor: 1, eye: 2 };
/** Eye expressions are morph targets on the one agent mesh. "happy" swaps the
 *  pills for ^ ^ arcs (arcs rest collapsed; pills collapse when happy). */
export const EYE_MORPHS = ["blink", "angry", "sad", "surprised", "happy"];

/** Visor + eyes in rest-pose world coords, every vertex skinned to `headIndex`.
 *  Returns { geo, morphs: { name: Float32Array of target positions } }. */
function faceGeometry(headIndex) {
  const visor = new THREE.SphereGeometry(1, 40, 24)
    .applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(0, 2.98, 0.7), new THREE.Quaternion(), new THREE.Vector3(0.8, 0.46, 0.44)));
  const centre = (side) => new THREE.Vector3(side * 0.21, 3.0, 1.1);
  const pose = (side, { rot = 0, sx = 1, sy = 1 } = {}) => new THREE.Matrix4()
    .makeTranslation(centre(side))
    .multiply(new THREE.Matrix4().makeRotationZ(rot))
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sx));
  const both = (geo, poses) => mergeGeometries([-1, 1].map((side) => geo.clone().applyMatrix4(pose(side, poses(side)))));
  const gone = () => ({ sx: 0.001, sy: 0.001 });
  const pill = new THREE.CapsuleGeometry(0.075, 0.2, 4, 12), arc = new THREE.TorusGeometry(0.11, 0.035, 6, 20, Math.PI);
  const pills = { rest: both(pill, () => ({})), blink: both(pill, () => ({ sy: 0.1 })), angry: both(pill, (side) => ({ rot: side * 0.45, sy: 0.7 })),
    sad: both(pill, (side) => ({ rot: -side * 0.35 })), surprised: both(pill, () => ({ sx: 1.35, sy: 1.35 })), happy: both(pill, gone) };
  const arcs = { rest: both(arc, gone), happy: both(arc, () => ({})) };

  const pieces = [[visor, PART.visor, {}], [pills.rest, PART.eye, pills], [arcs.rest, PART.eye, arcs]];
  const geos = [], morphs = Object.fromEntries(EYE_MORPHS.map((name) => [name, []]));
  for (const [geo, part, targets] of pieces) {
    for (const name of Object.keys(geo.attributes)) if (name !== "position" && name !== "normal") geo.deleteAttribute(name);
    const n = geo.attributes.position.count;
    geo.setAttribute("_part", new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
    geo.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(n * 4).fill(0).map((_, i) => (i % 4 ? 0 : headIndex)), 4));
    geo.setAttribute("skinWeight", new THREE.BufferAttribute(new Float32Array(n * 4).map((_, i) => (i % 4 ? 0 : 1)), 4));
    if (!geo.index) geo.setIndex([...Array(n).keys()]);
    geos.push(geo);
    const rest = geo.attributes.position.array;
    for (const name of EYE_MORPHS) morphs[name].push((targets[name] ?? geo).attributes.position.array.map((v, i) => v - rest[i]));
  }
  return { geos, morphs };
}

// ---------- baseball cap (hugs the bean's top sphere) ----------
/** Crown edge as polar angle per azimuth (0 = front): high in front so the brim
 *  clears the visor, low at the back so the cap sits down over the head. */
const capEdge = (phi) => 1.06 - 0.26 * Math.cos(phi);

export function buildCap(fabric, accent) {
  const R = BODY.radius + 0.04;
  const at = (phi, polar, r = R) => new THREE.Vector3(r * Math.sin(polar) * Math.sin(phi), r * Math.cos(polar), r * Math.sin(polar) * Math.cos(phi));
  const cap = new THREE.Group();
  cap.position.set(0, BODY.center[1] + BODY.half, 0);
  cap.scale.set(1, 1, BODY.squash);

  // crown: a sphere patch whose lower edge follows capEdge; slightly puffed toward the top
  const U = 96, V = 24, pos = [], index = [];
  for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) {
    const phi = (i / U) * Math.PI * 2, v = j / V, polar = v * capEdge(phi);
    pos.push(...at(phi, polar, R + 0.05 * (1 - v) * (1 - v)).toArray());
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) {
    const a = j * (U + 1) + i, b = a + U + 1;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const crownGeo = new THREE.BufferGeometry();
  crownGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  crownGeo.setIndex(index);
  crownGeo.computeVertexNormals();
  const crown = new THREE.Mesh(crownGeo, fabric);
  crown.castShadow = true;
  cap.add(crown);

  // rim band, panel seams, button
  const rim = new THREE.CatmullRomCurve3(Array.from({ length: 96 }, (_, i) => { const phi = (i / 96) * Math.PI * 2; return at(phi, capEdge(phi), R + 0.005); }), true);
  cap.add(new THREE.Mesh(new THREE.TubeGeometry(rim, 128, 0.04, 8, true), fabric));
  const seamMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d9, roughness: 0.85 });
  for (let k = 0; k < 6; k++) {
    const phi = (k / 6) * Math.PI * 2 + Math.PI / 6;
    const pts = Array.from({ length: 20 }, (_, i) => { const v = i / 19; return at(phi, v * capEdge(phi), R + 0.05 * (1 - v) * (1 - v) + 0.006); });
    cap.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.011, 4), seamMat));
  }
  const button = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 12), fabric);
  button.position.y = R + 0.05; button.scale.y = 0.45; cap.add(button);

  // brim: crescent from the front rim forward, sides curling down
  const front = capEdge(0), rimY = R * Math.cos(front), rimR = R * Math.sin(front), reach = 0.7;
  const shape = new THREE.Shape(), steps = 32;
  for (let i = 0; i <= steps; i++) { const a = (i / steps) * Math.PI; shape.lineTo(Math.cos(a) * rimR, Math.sin(a) * (rimR + reach)); }
  for (let i = steps; i >= 0; i--) { const a = (i / steps) * Math.PI; shape.lineTo(Math.cos(a) * rimR * 0.98, Math.sin(a) * rimR * 0.98); }
  const brimGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 24 });
  brimGeo.rotateX(Math.PI / 2); // shape y → +z (front), thickness downwards
  const bp = brimGeo.getAttribute("position");
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i), z = bp.getZ(i);
    bp.setY(i, bp.getY(i) - 0.2 * (x / rimR) ** 2 * Math.min(Math.max(z, 0) / (rimR + reach), 1));
  }
  brimGeo.computeVertexNormals();
  const brim = new THREE.Mesh(brimGeo, fabric);
  brim.castShadow = true;
  brim.position.y = rimY + 0.02;
  brim.rotation.x = 0.1; // a touch downward
  cap.add(brim);

  // star patch on the front panel
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.075 : 0.17, a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    i ? star.lineTo(Math.cos(a) * r, Math.sin(a) * r) : star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starMesh = new THREE.Mesh(new THREE.ExtrudeGeometry(star, { depth: 0.02, bevelEnabled: false }), accent);
  const polar = 0.48, r = R + 0.05 * (1 - polar / front) ** 2 + 0.004;
  starMesh.position.copy(at(0, polar, r));
  starMesh.lookAt(at(0, polar, r * 2));
  cap.add(starMesh);
  return cap;
}
