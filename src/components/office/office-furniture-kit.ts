// Office view (fork): loads the furniture models (Kenney Furniture Kit, CC0)
// once, brings each to its real size (lib/office-furniture), stands it on the
// floor centred on its spot, and hands out cheap copies (shared geometry).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FURNITURE, FURNITURE_PALETTE, type FurnitureModel, type Placement } from "@/lib/office-furniture";

const BASE_URL = "/office/furniture/";

export class FurnitureKit {
  private models = new Map<FurnitureModel, { scene: THREE.Object3D; size: THREE.Vector3 }>();

  /** Resolves once every model is in; a missing one is simply left out. */
  async load(): Promise<void> {
    const loader = new GLTFLoader();
    await Promise.all((Object.keys(FURNITURE) as FurnitureModel[]).map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`${BASE_URL}${name}.glb`);
        gltf.scene.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        // stand it on y=0, centred on its own x/z
        gltf.scene.position.sub(new THREE.Vector3(centre.x, box.min.y, centre.z));
        gltf.scene.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          for (const material of [mesh.material].flat() as THREE.MeshStandardMaterial[]) {
            const color = FURNITURE_PALETTE[material.name];
            if (color) material.color.set(color);
          }
        });
        this.models.set(name, { scene: gltf.scene, size });
      } catch {
        // without this model the office is simply a little emptier
      }
    }));
  }

  get ready(): boolean {
    return this.models.size > 0;
  }

  /** A copy of `model` at its real size, placed as asked; null if not loaded. */
  place(item: Placement): THREE.Object3D | null {
    const model = this.models.get(item.model);
    if (!model) return null;
    const holder = new THREE.Group();
    const copy = model.scene.clone(true);
    if (item.stretch) {
      copy.scale.set(item.stretch.x / Math.max(1e-6, model.size.x), 1, item.stretch.z / Math.max(1e-6, model.size.z));
      copy.position.multiply(copy.scale);
    } else {
      const { axis, size } = FURNITURE[item.model];
      const factor = size / Math.max(1e-6, model.size[axis]);
      copy.scale.setScalar(factor);
      copy.position.multiplyScalar(factor);
    }
    holder.add(copy);
    holder.position.set(item.x, item.y ?? 0, item.z);
    holder.rotation.y = item.rotY ?? 0;
    return holder;
  }

  dispose(): void {
    for (const { scene } of this.models.values()) {
      scene.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of [mesh.material].flat()) material.dispose();
      });
    }
    this.models.clear();
  }
}
