// Office view (fork): bake what never moves into a few big meshes. The office
// is hundreds of small meshes (desks, legs, chairs, Kenney furniture, frames);
// each costs a draw call and a matrix update every frame. Merged per material
// they draw the same pixels at a fraction of the cost.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Mark a subtree that never moves, never changes material and is never
 * picked: mergeStatic() may bake it. */
export function markStatic<T extends THREE.Object3D>(object: T): T {
  object.userData.static = true;
  return object;
}

/** Same values, plain floats (quantized or interleaved glTF data included),
 * so a matrix can be applied and different sources merged. */
function floatAttribute(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): THREE.BufferAttribute {
  const { count, itemSize } = attribute;
  const array = new Float32Array(count * itemSize);
  for (let i = 0; i < count; i += 1) {
    for (let k = 0; k < itemSize; k += 1) array[i * itemSize + k] = attribute.getComponent(i, k);
  }
  return new THREE.BufferAttribute(array, itemSize);
}

function mergeable(mesh: THREE.Mesh): boolean {
  if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return false;
  if (Array.isArray(mesh.material) || mesh.material.transparent) return false; // own depth sort
  if (mesh.userData.botId || mesh.userData.deskId) return false; // picked
  if (Object.keys(mesh.geometry.morphAttributes).length) return false;
  // a mirrored mesh would turn inside out (its winding flips)
  if (mesh.matrixWorld.determinant() <= 0) return false;
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/** Drop empty groups under `node`; true when `node` itself is left empty. */
function prune(node: THREE.Object3D): boolean {
  // a copy: removing a child changes the list
  for (const child of node.children.slice()) if (prune(child)) child.removeFromParent();
  return node.children.length === 0 && (node.type === "Group" || node.type === "Object3D");
}

/** Bake every marked subtree under `root` into one mesh per material and
 * shadow setting, added to `into` (at the world origin). Returns the baked
 * geometries, to dispose of on the next bake. */
export function mergeStatic(root: THREE.Object3D, into: THREE.Object3D): THREE.BufferGeometry[] {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { material: THREE.Material; castShadow: boolean; receiveShadow: boolean; meshes: THREE.Mesh[] }>();
  root.traverse((node) => {
    if (!node.userData.static) return;
    node.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mergeable(mesh)) return;
      const material = mesh.material as THREE.Material;
      const attributes = Object.keys(mesh.geometry.attributes).sort().join(",");
      const key = `${material.uuid}|${mesh.castShadow}|${mesh.receiveShadow}|${attributes}`;
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, (bucket = { material, castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, meshes: [] }));
      if (!bucket.meshes.includes(mesh)) bucket.meshes.push(mesh);
    });
  });
  const baked: THREE.BufferGeometry[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.meshes.length < 2) continue;
    // every part indexed or none: mergeGeometries needs them alike
    const indexed = bucket.meshes.every((mesh) => mesh.geometry.index);
    const parts = bucket.meshes.map((mesh) => {
      const source = mesh.geometry;
      const geometry = new THREE.BufferGeometry();
      for (const [name, attribute] of Object.entries(source.attributes)) geometry.setAttribute(name, floatAttribute(attribute));
      if (source.index) geometry.setIndex(source.index.clone());
      return (source.index && !indexed ? geometry.toNonIndexed() : geometry).applyMatrix4(mesh.matrixWorld);
    });
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!merged) continue; // unlike attributes: the originals stay as they are
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.castShadow = bucket.castShadow;
    mesh.receiveShadow = bucket.receiveShadow;
    mesh.matrixAutoUpdate = false;
    into.add(mesh);
    baked.push(merged);
    for (const original of bucket.meshes) original.removeFromParent();
  }
  // what is left of a baked subtree is empty groups: still walked every frame
  const roots: THREE.Object3D[] = [];
  root.traverse((node) => node.userData.static && roots.push(node));
  for (const node of roots) if (prune(node)) node.removeFromParent();
  return baked;
}
