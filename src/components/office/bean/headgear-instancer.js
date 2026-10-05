// Headgear layer at runtime: every agent wearing the same piece is drawn in
// one InstancedMesh per material, whatever the number of agents. One prototype
// per piece runs its idle motion; each instance = wearer's head anchor × the
// prototype part's pose. Meshes made with the `tint` material take the
// wearer's body colour per instance.
import * as THREE from "three";
import { buildAccessories } from "./accessories.js";

/** a piece's reach round its head anchor (metres) */
const _sphere = new THREE.Sphere(new THREE.Vector3(), 0.6);

export class HeadgearInstancer {
  constructor(scene, { capacity = 128 } = {}) {
    this.scene = scene;
    this.capacity = capacity;
    this.tint = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.25, sheen: 0.4, sheenRoughness: 0.6 });
    this.types = new Map(); // name → { proto, tick, parts: [{ node, inst, tinted }] }
    this.wearers = new Map(); // agent → { type, color }
    for (const [name, { object, tick }] of Object.entries(buildAccessories({ tint: this.tint }))) {
      const parts = [];
      object.traverse((node) => {
        if (!node.isMesh) return;
        const tinted = node.material === this.tint;
        const inst = new THREE.InstancedMesh(node.geometry, node.material, capacity);
        inst.name = `${name}:${node.material.name || node.material.type}`;
        inst.castShadow = node.castShadow; // false — accessories.js owns that rule
        inst.frustumCulled = false; // instances move every frame; bounds would go stale
        inst.count = 0;
        inst.visible = false;
        if (tinted) inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        scene.add(inst);
        parts.push({ node, inst, tinted });
      });
      this.types.set(name, { proto: object, tick, parts });
    }
  }

  get names() { return [...this.types.keys()]; }

  /** Put `type` (or null) on an agent from agent.js. */
  wear(agent, type, color) {
    if (type && !this.types.has(type)) console.warn(`headgear: no piece called "${type}" (accessories.js)`);
    if (type && this.types.has(type)) this.wearers.set(agent, { type, color: new THREE.Color(color) });
    else this.wearers.delete(agent);
  }

  setColor(agent, color) { this.wearers.get(agent)?.color.set(color); }

  /** After the mixers and scene.updateMatrixWorld(): anchors must be current. */
  update(t, dt) {
    const byType = new Map();
    for (const [agent, w] of this.wearers) {
      if (!byType.has(w.type)) byType.set(w.type, []);
      byType.get(w.type).push([agent, w]);
    }
    const m = new THREE.Matrix4();
    for (const [name, { proto, tick, parts }] of this.types) {
      const list = byType.get(name) ?? [];
      for (const p of parts) { p.inst.count = list.length; p.inst.visible = list.length > 0; }
      if (!list.length) continue;
      tick?.(t, dt);
      proto.updateMatrixWorld(true);
      list.forEach(([agent, w], k) => {
        for (const p of parts) {
          p.inst.setMatrixAt(k, m.multiplyMatrices(agent.anchor.matrixWorld, p.node.matrixWorld));
          if (p.tinted) p.inst.setColorAt(k, w.color);
        }
      });
      for (const p of parts) {
        p.inst.instanceMatrix.needsUpdate = true;
        if (p.tinted) p.inst.instanceColor.needsUpdate = true;
      }
    }
  }

  /** Whether a piece that moves by itself (a propeller, a swaying antenna) is
   *  worn within `frustum`: then the view must keep drawing. */
  animatesIn(frustum) {
    for (const [agent, w] of this.wearers) {
      if (!this.types.get(w.type)?.tick) continue;
      _sphere.center.setFromMatrixPosition(agent.anchor.matrixWorld);
      if (frustum.intersectsSphere(_sphere)) return true;
    }
    return false;
  }

  /** Every piece visible once (at `agent`), for shader warm-up — see render-perf.js. */
  showAll(agent) {
    for (const { proto, parts } of this.types.values()) {
      proto.updateMatrixWorld(true);
      for (const p of parts) {
        p.inst.count = 1;
        p.inst.visible = true;
        p.inst.setMatrixAt(0, new THREE.Matrix4().multiplyMatrices(agent.anchor.matrixWorld, p.node.matrixWorld));
        if (p.tinted) p.inst.setColorAt(0, new THREE.Color(1, 1, 1));
        p.inst.instanceMatrix.needsUpdate = true;
      }
    }
  }
}
