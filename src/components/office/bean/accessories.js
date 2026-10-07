// Headgear for the bean agent. Every piece is built around the head sphere:
// origin = centre of the bean's top hemisphere in the rest pose (agent.js puts
// an anchor there on the Head bone). Some pieces get a small idle motion via
// tick(t, dt). Headgear never casts shadows: it sits inside the body's shadow,
// and skipping it halves its draw calls.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { BODY, buildCap } from "./bean.js";

const R = BODY.radius, SQ = BODY.squash, UP = new THREE.Vector3(0, 1, 0);

/** Point on (or `off` above) the head; phi 0 = front, polar 0 = top. */
const head = (phi, polar, off = 0) => {
  const r = R + off;
  return new THREE.Vector3(r * Math.sin(polar) * Math.sin(phi), r * Math.cos(polar), r * Math.sin(polar) * Math.cos(phi) * SQ);
};
const normalAt = (phi, polar) => new THREE.Vector3(Math.sin(polar) * Math.sin(phi), Math.cos(polar), (Math.sin(polar) * Math.cos(phi)) / SQ).normalize();
/** Stand an object on the head, its local +Y along the surface normal. */
function plant(obj, phi, polar, off = 0) {
  obj.position.copy(head(phi, polar, off));
  obj.quaternion.setFromUnitVectors(UP, normalAt(phi, polar));
  return obj;
}

const mesh = (geo, mat, pos) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(...pos); return m; };
const group = (...kids) => { const g = new THREE.Group(); g.add(...kids); return g; };
const lathe = (pts, segs = 48) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs);

/** A tube along a curve with a radius profile (horns, stalks, bands). */
function sweep(curve, radiusAt, { tub = 96, rad = 24, closed = false } = {}) {
  const frames = curve.computeFrenetFrames(tub, closed), pos = [], nrm = [], idx = [];
  const P = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i <= tub; i++) {
    const t = i / tub, r = radiusAt(t), k = closed && i === tub ? 0 : i;
    curve.getPointAt(closed ? t % 1 : t, P);
    for (let j = 0; j <= rad; j++) {
      const a = (j / rad) * Math.PI * 2;
      d.copy(frames.normals[k]).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[k], Math.sin(a));
      pos.push(P.x + d.x * r, P.y + d.y * r, P.z + d.z * r);
      nrm.push(d.x, d.y, d.z);
    }
  }
  for (let i = 0; i < tub; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}

/** A flat ribbon along points: width along the (fixed) up axis, given thickness. */
function ribbon(points, widthAt, thick, samples = 160) {
  const curve = new THREE.CatmullRomCurve3(points), pos = [], idx = [];
  const T = new THREE.Vector3(), N = new THREE.Vector3(), U = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    curve.getPointAt(t, P); curve.getTangentAt(t, T);
    U.set(0, 1, 0).addScaledVector(T, -T.y).normalize(); // up, kept square to the path
    N.crossVectors(T, U).normalize();
    const w = widthAt(t) / 2, h = thick / 2;
    for (const [a, b] of [[w, h], [-w, h], [-w, -h], [w, -h]]) pos.push(P.x + U.x * a + N.x * b, P.y + U.y * a + N.y * b, P.z + U.z * a + N.z * b);
  }
  for (let i = 0; i < samples; i++) for (let k = 0; k < 4; k++) {
    const a = i * 4 + k, b = i * 4 + ((k + 1) % 4), c = a + 4, d = b + 4;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Dome over the head down to a per-azimuth edge (caps, beanies). */
function dome(edge, off, { ribs = 0, colors = null } = {}) {
  const U = 96, V = 24, pos = [], col = [], index = [];
  for (let j = 0; j <= V; j++) for (let i = 0; i <= U; i++) {
    const phi = (i / U) * Math.PI * 2, v = j / V;
    const r = off + 0.04 * (1 - v) ** 2 + (ribs ? 0.01 * Math.cos(phi * ribs) * Math.min(v * 4, 1) : 0);
    pos.push(...head(phi, v * edge(phi), r).toArray());
    if (colors) col.push(...colors(phi).toArray());
  }
  for (let j = 0; j < V; j++) for (let i = 0; i < U; i++) {
    const a = j * (U + 1) + i, b = a + U + 1;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  if (colors) geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}
const rimCurve = (edge, off) => new THREE.CatmullRomCurve3(Array.from({ length: 120 }, (_, i) => { const phi = (i / 120) * Math.PI * 2; return head(phi, edge(phi), off); }), true);

/** Pom-pom: a dense sphere with deterministic fuzz (shared vertices move together). */
function pompom(r, mat) {
  const geo = new THREE.IcosahedronGeometry(r, 3), p = geo.getAttribute("position"), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const h = Math.sin(v.x * 91.7 + v.y * 47.3 + v.z * 73.1) * 43758.5453;
    v.multiplyScalar(1 + 0.12 * (h - Math.floor(h)));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return mesh(geo, mat);
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

function stripes(colors, n = 8) {
  const c = document.createElement("canvas"); c.width = c.height = 256;
  const g = c.getContext("2d");
  for (let i = -n; i < n * 2; i++) {
    g.fillStyle = colors[((i % colors.length) + colors.length) % colors.length];
    g.beginPath();
    const w = 256 / n;
    g.moveTo(i * w, 0); g.lineTo(i * w + w, 0); g.lineTo(i * w + w - 256, 256); g.lineTo(i * w - 256, 256); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Merge every static mesh under `root` into one mesh per material (fewer draw
 *  calls). Subtrees flagged userData.moves keep their own node and get the
 *  same treatment inside, so idle motions still work. */
function compact(root) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert(), buckets = new Map();
  const visit = (node) => {
    // a copy: merged meshes leave node.children while it is walked
    for (const child of node.children.slice()) {
      if (child.userData.moves) { compact(child); continue; }
      if (child.isMesh) {
        const geo = child.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, child.matrixWorld));
        const mat = child.material, keep = ["position", "normal", ...(mat.map ? ["uv"] : []), ...(mat.vertexColors ? ["color"] : [])];
        for (const name of Object.keys(geo.attributes)) if (!keep.includes(name)) geo.deleteAttribute(name);
        if (!geo.index) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
        if (!buckets.has(mat)) buckets.set(mat, []);
        buckets.get(mat).push(geo);
        child.removeFromParent();
      } else visit(child);
    }
  };
  visit(root);
  for (const [mat, geos] of buckets) {
    const m = new THREE.Mesh(geos.length > 1 ? mergeGeometries(geos) : geos[0], mat);
    m.castShadow = false; // see header
    root.add(m);
  }
}

/** Builds every headgear prototype once. `tint` marks meshes that take the
 *  wearer's body colour (antenna ball, ears) — the instancer colours them per agent. */
export function buildAccessories({ tint }) {
  const body = tint;
  const M = {
    dark: new THREE.MeshPhysicalMaterial({ color: 0x1b1b1e, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 }),
    soft: new THREE.MeshPhysicalMaterial({ color: 0x2a2a2e, roughness: 0.9, sheen: 1, sheenRoughness: 0.6, sheenColor: 0x555560 }),
    knit: new THREE.MeshPhysicalMaterial({ color: 0x1f1f23, roughness: 0.95, sheen: 1, sheenRoughness: 0.5, sheenColor: 0x6a6a75 }),
    white: new THREE.MeshPhysicalMaterial({ color: 0xf4f4f6, roughness: 0.75, sheen: 1, sheenRoughness: 0.8, sheenColor: 0xffffff, side: THREE.DoubleSide }),
    gold: new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.22, metalness: 1 }),
    ruby: new THREE.MeshPhysicalMaterial({ color: 0xe0103a, roughness: 0.05, clearcoat: 1, metalness: 0.1 }),
    sapphire: new THREE.MeshPhysicalMaterial({ color: 0x1e5bff, roughness: 0.05, clearcoat: 1, metalness: 0.1 }),
    pink: new THREE.MeshPhysicalMaterial({ color: 0xffb3c8, roughness: 0.6, sheen: 0.6 }),
    red: new THREE.MeshPhysicalMaterial({ color: 0xff2d3a, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.15 }),
    leaf: new THREE.MeshPhysicalMaterial({ color: 0x45c75a, roughness: 0.45, sheen: 0.5, sheenColor: 0xbaffc4, side: THREE.DoubleSide }),
    orange: new THREE.MeshPhysicalMaterial({ color: 0xff6a13, roughness: 0.4, clearcoat: 0.5 }),
    reflect: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 0.15 }),
    satin: new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.4, sheen: 1, sheenRoughness: 0.35, sheenColor: 0x4a4a55 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x0b0b0e, roughness: 0.04, metalness: 0.3, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [200, 600] }),
    glow: new THREE.MeshBasicMaterial({ color: 0xd8f8ff, toneMapped: false }),
    haze: new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }),
    led: new THREE.MeshBasicMaterial({ color: 0xb48cff, toneMapped: false }),
  };
  const out = {};
  const add = (name, obj, tick) => {
    const root = group(obj);
    compact(root);
    out[name] = { object: root, tick };
  };

  // ---- Pet (baseball cap)
  add("Pet", (() => { const c = buildCap(M.white, new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.6 })); c.position.set(0, 0, 0); return c; })());

  // ---- Antenne: socket, curved stalk, glossy ball; sways
  {
    const socket = mesh(lathe([[0.15, -0.04], [0.15, 0.02], [0.12, 0.06], [0.05, 0.08], [0, 0.08]], 48), M.dark);
    const stalk = mesh(sweep(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0, 0.45, 0), new THREE.Vector3(0.16, 0.72, 0)), () => 0.03, { rad: 12 }), M.dark);
    const ball = mesh(new THREE.SphereGeometry(0.15, 24, 16), body, [0.2, 0.82, 0]);
    const sway = group(stalk, ball);
    sway.userData.moves = true;
    add("Antenne", plant(group(socket, sway), 0.55, 0.42, -0.02), (t) => { sway.rotation.z = Math.sin(t * 2.3) * 0.08; sway.rotation.x = Math.sin(t * 1.7) * 0.05; });
  }

  // ---- Halo: crisp ring + soft additive haze; floats and turns
  {
    const ring = mesh(new THREE.TorusGeometry(0.6, 0.045, 10, 72), M.glow);
    const haze = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.14, 10, 72), M.haze);
    const inner = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.08, 10, 72), M.haze);
    const halo = group(ring, haze, inner);
    halo.rotation.x = Math.PI / 2 - 0.12;
    halo.userData.moves = true;
    add("Halo", halo, (t) => { halo.position.y = 1.45 + Math.sin(t * 1.6) * 0.04; halo.rotation.z = t * 0.4; });
  }

  // ---- Oren (bunny): revolved petal, flattened, pink inner; one ear flops
  {
    const prof = [[0, 0], [0.12, 0.02], [0.19, 0.16], [0.215, 0.42], [0.2, 0.66], [0.155, 0.86], [0.085, 0.98], [0, 1.02]];
    const ears = [-1, 1].map((s) => {
      const outer = mesh(lathe(prof, 48), body); outer.scale.set(1, 1, 0.42);
      const inner = mesh(lathe(prof, 48), M.pink); inner.scale.set(0.6, 0.82, 0.16); inner.position.set(0, 0.1, 0.07);
      const ear = group(outer, inner);
      ear.userData.moves = true;
      const pivot = plant(group(ear), s * 0.42, 0.42, -0.08);
      pivot.rotateZ(-s * 0.12);
      return { ear, s };
    });
    add("Oren", group(...ears.map((e) => e.ear.parent)), (t) => {
      ears[0].ear.rotation.x = -0.35 + Math.sin(t * 1.3) * 0.05;              // left ear: floppy
      ears[1].ear.rotation.x = Math.max(0, Math.sin(t * 0.9)) ** 8 * -0.25;  // right ear: twitch now and then
    });
  }

  // ---- Koptelefoon: swept band + padded cushion, lathed cups with LED rings
  {
    const band = new THREE.CurvePath();
    const arc = (sx, sy, from, to) => new THREE.CatmullRomCurve3(Array.from({ length: 40 }, (_, i) => { const a = from + ((to - from) * i) / 39; return new THREE.Vector3(sx * Math.sin(a), 0.55 + sy * Math.cos(a), 0); }));
    band.add(arc(1.13, 0.62, -Math.PI / 2, Math.PI / 2));
    const metal = mesh(sweep(arc(1.13, 0.62, -Math.PI / 2, Math.PI / 2), () => 0.045, { tub: 64, rad: 10 }), M.dark);
    const pad = mesh(sweep(arc(1.09, 0.58, -0.75, 0.75), (t) => 0.085 * Math.sin(Math.PI * t) ** 0.3, { tub: 48, rad: 12 }), M.soft);
    const cups = [-1, 1].map((s) => {
      const shell = mesh(lathe([[0.3, 0.03], [0.335, 0.08], [0.345, 0.16], [0.325, 0.25], [0.27, 0.3], [0.12, 0.315], [0, 0.315]], 64), M.dark);
      const cushion = mesh(new THREE.TorusGeometry(0.25, 0.085, 10, 40), M.soft); cushion.rotation.x = Math.PI / 2; cushion.position.y = 0.04;
      const led = mesh(new THREE.TorusGeometry(0.22, 0.022, 6, 40), M.led); led.rotation.x = Math.PI / 2; led.position.y = 0.3;
      const cup = group(shell, cushion, led);
      cup.rotation.z = -s * Math.PI / 2;
      cup.position.set(s * 1.07, 0.32, 0);
      return cup;
    });
    add("Koptelefoon", group(metal, pad, ...cups));
  }

  // ---- Zonnebril: framed, iridescent lenses that wrap the visor, temples to the back
  {
    const parts = [-1, 1].map((s) => {
      const lensShape = roundedRect(0.56, 0.32, 0.13);
      const lensGeo = new THREE.ExtrudeGeometry(lensShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 6 });
      const frameShape = roundedRect(0.66, 0.42, 0.18); frameShape.holes.push(roundedRect(0.56, 0.32, 0.13));
      const frameGeo = new THREE.ExtrudeGeometry(frameShape, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 6 });
      const g = group(mesh(lensGeo, M.lens), mesh(frameGeo, M.dark));
      g.position.set(s * 0.34, 0.26, 1.12);
      g.rotation.y = s * 0.34;
      return g;
    });
    const bridge = mesh(sweep(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.07, 0.3, 1.2), new THREE.Vector3(0, 0.35, 1.23), new THREE.Vector3(0.07, 0.3, 1.2)), () => 0.022, { rad: 10, tub: 16 }), M.dark);
    const temples = [-1, 1].map((s) => mesh(sweep(new THREE.CatmullRomCurve3([
      new THREE.Vector3(s * 0.64, 0.3, 1.0), new THREE.Vector3(s * 0.92, 0.31, 0.62), new THREE.Vector3(s * 1.05, 0.31, 0.15), new THREE.Vector3(s * 0.97, 0.29, -0.32),
    ]), () => 0.022, { rad: 10, tub: 48 }), M.dark));
    add("Zonnebril", group(...parts, bridge, ...temples));
  }

  // ---- Muts (beanie): ribbed knit dome, rolled ribbed cuff, label, pom-pom
  {
    const edge = (phi) => 1.1 - 0.28 * Math.cos(phi);
    const crown = mesh(dome(edge, 0.06, { ribs: 48 }), M.knit);
    const cuff = mesh(sweep(rimCurve(edge, 0.08), (t) => 0.13 + 0.012 * Math.cos(t * Math.PI * 2 * 64), { tub: 256, rad: 10, closed: true }), M.knit);
    const label = mesh(new THREE.BoxGeometry(0.3, 0.13, 0.02), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7 }));
    label.position.copy(head(0, edge(0) - 0.02, 0.22));
    label.lookAt(head(0, edge(0) - 0.02, 2));
    const pom = pompom(0.17, M.knit); pom.position.set(0, R + 0.2, 0);
    add("Muts", group(crown, cuff, label, pom));
  }

  // ---- Kroon: flared band with five rounded points, ball tips, jewels, rim
  {
    const n = 5, N = 240, height = (phi) => 0.2 + 0.26 * Math.abs(Math.cos((phi * n) / 2)) ** 4;
    const radius = (y) => 0.5 + 0.06 * y, thick = 0.035, pos = [], idx = [];
    for (let i = 0; i <= N; i++) {
      const phi = (i / N) * Math.PI * 2, h = height(phi), sx = Math.sin(phi), cz = Math.cos(phi);
      for (const [r, y] of [[radius(0), 0], [radius(h), h], [radius(h) - thick, h], [radius(0) - thick, 0]]) pos.push(r * sx, y, r * cz);
    }
    for (let i = 0; i < N; i++) for (let k = 0; k < 3; k++) {
      const a = i * 4 + k, b = a + 4;
      idx.push(a, b, a + 1, b, b + 1, a + 1); // outer wall, top lip, inner wall
    }
    const bandGeo = new THREE.BufferGeometry();
    bandGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    bandGeo.setIndex(idx);
    bandGeo.computeVertexNormals();
    const gold2 = M.gold.clone(); gold2.side = THREE.DoubleSide;
    const bits = [mesh(bandGeo, gold2)];
    const rim = mesh(new THREE.TorusGeometry(radius(0) - 0.01, 0.035, 8, 64), M.gold); rim.rotation.x = Math.PI / 2;
    const rim2 = mesh(new THREE.TorusGeometry(radius(0.17) - 0.01, 0.022, 6, 64), M.gold); rim2.rotation.x = Math.PI / 2; rim2.position.y = 0.17;
    bits.push(rim, rim2);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2, b = a + Math.PI / n, h = height(a);
      bits.push(mesh(new THREE.SphereGeometry(0.05, 12, 8), M.gold, [(radius(h) - 0.015) * Math.sin(a), h + 0.03, (radius(h) - 0.015) * Math.cos(a)]));
      const jewel = mesh(new THREE.SphereGeometry(0.05, 12, 8), k % 2 ? M.sapphire : M.ruby, [(radius(0.09) + 0.01) * Math.sin(b), 0.09, (radius(0.09) + 0.01) * Math.cos(b)]);
      jewel.scale.set(1, 1, 0.55); jewel.lookAt(0, 0.09, 0);
      bits.push(jewel);
    }
    const crown = group(...bits);
    crown.position.y = 0.9; // level, rim resting on the head (radius 0.5 meets the head at y ≈ 0.89–0.92)
    add("Kroon", crown);
  }

  // ---- Kiemplant: curved stem, two cupped leaves; sways
  {
    const stem = mesh(sweep(new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0.04, 0.25, 0), new THREE.Vector3(-0.02, 0.45, 0)), (t) => 0.03 - 0.01 * t, { rad: 12 }), M.leaf);
    const leafShape = new THREE.Shape(); leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(0.2, 0.15, 0.4, 0); leafShape.quadraticCurveTo(0.2, -0.15, 0, 0);
    const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 24 });
    const lp = leafGeo.getAttribute("position");
    for (let i = 0; i < lp.count; i++) { const x = lp.getX(i), y = lp.getY(i); lp.setZ(i, lp.getZ(i) + 0.5 * y * y + 0.25 * x * x); }
    leafGeo.computeVertexNormals();
    const leaves = [-1, 1].map((s) => { const l = mesh(leafGeo, M.leaf); l.rotation.set(-Math.PI / 2 + 0.5, s < 0 ? Math.PI : 0, s * 0.35); l.position.set(-0.02, 0.44, 0); return l; });
    const top = group(...leaves);
    top.userData.moves = true;
    const plant_ = plant(group(stem, top), 0.1, 0.05, -0.02);
    plant_.userData.moves = true;
    add("Kiemplant", plant_, (t) => { plant_.rotation.z = Math.sin(t * 1.4) * 0.07; top.rotation.y = Math.sin(t * 0.8) * 0.2; });
  }

  // ---- Hoorns (devil): tapered swept horns curling out and up
  {
    const horns = [-1, 1].map((s) => {
      const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(0, -0.06, 0), new THREE.Vector3(s * 0.04, 0.22, 0.02), new THREE.Vector3(s * 0.26, 0.36, 0), new THREE.Vector3(s * 0.2, 0.6, -0.06));
      return plant(mesh(sweep(curve, (t) => 0.15 * (1 - t) ** 0.85 + 0.006, { tub: 48, rad: 16 }), M.red), s * 0.55, 0.5, -0.02);
    });
    add("Hoorns", group(...horns));
  }

  // ---- Kattenoren: soft rounded triangles, pink inner
  {
    const tri = (w, h, r) => { const s = new THREE.Shape(); s.moveTo(-w / 2 + r, 0); s.lineTo(w / 2 - r, 0); s.quadraticCurveTo(w / 2, 0, w / 2 - r * 0.6, r); s.lineTo(r * 0.5, h - r); s.quadraticCurveTo(0, h, -r * 0.5, h - r); s.lineTo(-w / 2 + r * 0.6, r); s.quadraticCurveTo(-w / 2, 0, -w / 2 + r, 0); return s; };
    const ears = [-1, 1].map((s) => {
      const outer = mesh(new THREE.ExtrudeGeometry(tri(0.55, 0.5, 0.09), { depth: 0.08, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.04, bevelSegments: 5, curveSegments: 16 }), body);
      const inner = mesh(new THREE.ExtrudeGeometry(tri(0.32, 0.3, 0.06), { depth: 0.01, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 }), M.pink, [0, 0.07, 0.13]);
      const ear = group(outer, inner);
      ear.position.z = -0.04;
      const p = plant(group(ear), s * 0.5, 0.48, -0.1);
      p.rotateZ(s * 0.08);
      return p;
    });
    add("Kattenoren", group(...ears));
  }

  // ---- Pylon: base plate + lathed cone with reflective stripes, tilted
  {
    const base = mesh(new THREE.BoxGeometry(0.66, 0.06, 0.66), M.orange); base.position.y = 0.03;
    const radiusAt = (y) => 0.27 - (0.2 * y) / 0.62;
    const cone = mesh(lathe([[0.28, 0.05], [0.27, 0.08], [0.07, 0.62], [0.05, 0.66], [0, 0.67]], 64), M.orange);
    const stripe = (y0, y1) => mesh(lathe([[radiusAt(y0) + 0.004, y0], [radiusAt(y1) + 0.004, y1]], 64), M.reflect);
    const pylon = group(base, cone, stripe(0.22, 0.3), stripe(0.4, 0.46));
    const p = plant(group(pylon), 0.15, 0.22, -0.03);
    p.rotateZ(-0.12);
    add("Pylon", p);
  }

  // ---- Hoge hoed: satin top hat with a red band, brim curled up at the sides
  {
    const geo = lathe([[0.001, 0], [0.5, 0], [0.86, 0.0], [0.9, 0.025], [0.87, 0.055], [0.52, 0.05], [0.5, 0.06], [0.53, 0.68], [0.52, 0.72], [0.46, 0.735], [0, 0.735]], 96);
    const p = geo.getAttribute("position");
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); if (y < 0.07) p.setY(i, y + 0.09 * (x / 0.9) ** 2 * Math.max(0, Math.hypot(x, p.getZ(i)) - 0.5) / 0.4); }
    geo.computeVertexNormals();
    const hat = mesh(geo, M.satin);
    const band = mesh(lathe([[0.508, 0.07], [0.52, 0.2]], 96), new THREE.MeshPhysicalMaterial({ color: 0xc4232b, roughness: 0.5, sheen: 0.8 }));
    const top = group(hat, band);
    top.position.y = 0.86; top.rotation.set(-0.06, 0, -0.14);
    add("Hoge hoed", top);
  }

  // ---- Feesthoed: striped cone with a pom-pom; tilted
  {
    const cone = mesh(lathe(Array.from({ length: 12 }, (_, i) => [0.4 * (1 - i / 11), (0.9 * i) / 11]), 64), new THREE.MeshPhysicalMaterial({ map: stripes(["#ff375f", "#ffd60a", "#0a84ff", "#ffffff"], 8), roughness: 0.45, clearcoat: 0.4 }));
    const rim = mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 48), M.gold); rim.rotation.x = Math.PI / 2;
    const pom = pompom(0.1, new THREE.MeshPhysicalMaterial({ color: 0xffd60a, roughness: 0.9, sheen: 1 })); pom.position.y = 0.95;
    const p = plant(group(cone, rim, pom), -0.45, 0.3, -0.05);
    p.rotateZ(0.1);
    add("Feesthoed", p);
  }

  // ---- Propellerpet: four-colour panels, little stem, spinning twisted blades
  {
    const panel = [new THREE.Color("#ff3b30"), new THREE.Color("#ffd60a"), new THREE.Color("#0a84ff"), new THREE.Color("#30d158")];
    const edge = (phi) => 0.98 - 0.2 * Math.cos(phi);
    const crown = mesh(dome(edge, 0.04, { colors: (phi) => panel[Math.floor((((phi + Math.PI / 4) % (Math.PI * 2)) / (Math.PI * 2)) * 4) % 4] }), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, sheen: 0.6 }));
    const rim = mesh(sweep(rimCurve(edge, 0.05), () => 0.035, { tub: 120, rad: 8, closed: true }), M.white);
    const stem = mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.18, 16), M.dark, [0, R + 0.12, 0]);
    const blade = new THREE.Shape(); blade.absellipse(0.27, 0, 0.27, 0.065, 0, Math.PI * 2);
    const bladeGeo = new THREE.ExtrudeGeometry(blade, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 16 });
    bladeGeo.rotateX(-Math.PI / 2);
    const blades = [0, 1].map((k) => { const b = mesh(bladeGeo, k ? M.sapphire : M.red); b.rotation.set(k ? 0.35 : -0.35, k * Math.PI, 0); return b; });
    const hub = mesh(new THREE.SphereGeometry(0.05, 16, 12), M.gold);
    const prop = group(...blades, hub); prop.position.y = R + 0.22;
    prop.userData.moves = true;
    add("Propellerpet", group(crown, rim, stem, prop), (t) => { prop.rotation.y = t * 9; });
  }

  // ---- Strik (bow): flat satin ribbon loops, a wrapped knot and two tails
  {
    const satin = new THREE.MeshPhysicalMaterial({ color: 0xff4f8b, roughness: 0.32, sheen: 1, sheenColor: 0xffc2d6, clearcoat: 0.5, side: THREE.DoubleSide });
    const loops = [-1, 1].map((s) => mesh(ribbon(Array.from({ length: 48 }, (_, i) => {
      const a = (i / 79) * Math.PI * 2, f = Math.sin(a / 2) ** 2; // 0 at the knot, 1 at the far end
      return new THREE.Vector3(s * 0.32 * f, 0.05 * f, 0.07 * Math.sin(a) * (0.4 + 0.6 * f));
    }), (t) => 0.09 + 0.13 * Math.sin(Math.PI * t) ** 2, 0.016), satin));
    const tails = [-1, 1].map((s) => mesh(ribbon([
      new THREE.Vector3(0, -0.02, 0.03), new THREE.Vector3(s * 0.08, -0.12, 0.05), new THREE.Vector3(s * 0.16, -0.24, 0.04), new THREE.Vector3(s * 0.2, -0.32, 0.02),
    ], (t) => 0.1 + 0.03 * t, 0.016, 32), satin));
    const knot = mesh(new THREE.SphereGeometry(1, 20, 14), satin); knot.scale.set(0.08, 0.1, 0.06); knot.position.z = 0.03;
    const bow = group(...loops, ...tails, knot);
    bow.position.copy(head(0.62, 0.5, 0.06));
    bow.lookAt(bow.position.clone().add(normalAt(0.62, 0.5)));
    bow.rotateZ(-0.35);
    bow.scale.setScalar(1.3);
    add("Strik", bow);
  }

  return out;
}
