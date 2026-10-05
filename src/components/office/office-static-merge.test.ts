import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { markStatic, mergeStatic } from "./office-static-merge";

const box = (material: THREE.Material, x: number) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
  mesh.position.x = x;
  return mesh;
};

const worldBox = (object: THREE.Object3D) => new THREE.Box3().setFromObject(object);

describe("mergeStatic", () => {
  it("bakes marked meshes into one mesh per material, in the same place", () => {
    const scene = new THREE.Scene();
    const wood = new THREE.MeshStandardMaterial();
    const group = markStatic(new THREE.Group());
    group.position.set(0, 2, 0);
    group.add(box(wood, 0), box(wood, 5));
    scene.add(group);
    const before = worldBox(group);
    const into = new THREE.Group();
    scene.add(into);

    const baked = mergeStatic(scene, into);

    expect(baked).toHaveLength(1);
    // the emptied group is gone too: nothing left to walk every frame
    expect(scene.children).toEqual([into]);
    expect(into.children).toHaveLength(1);
    expect(worldBox(into).equals(before)).toBe(true);
  });

  it("keeps what moves, is picked, is see-through or mirrored", () => {
    const scene = new THREE.Scene();
    const wood = new THREE.MeshStandardMaterial();
    const glass = new THREE.MeshStandardMaterial({ transparent: true });
    const loose = box(wood, 0); // not marked
    const picked = markStatic(box(wood, 1));
    picked.userData.botId = "bot";
    const panes = markStatic(new THREE.Group()).add(box(glass, 2), box(glass, 3));
    const mirrored = markStatic(box(wood, 4));
    mirrored.scale.x = -1;
    const hidden = markStatic(box(wood, 6));
    hidden.visible = false;
    scene.add(loose, picked, panes, mirrored, hidden);

    expect(mergeStatic(scene, new THREE.Group())).toHaveLength(0);
    expect(scene.children).toEqual([loose, picked, panes, mirrored, hidden]);
    expect(panes.children).toHaveLength(2);
    // what stays is frozen (no matrix work per frame), what is not marked is not
    expect([picked, mirrored, hidden, ...panes.children].every((mesh) => !mesh.matrixAutoUpdate)).toBe(true);
    expect(loose.matrixAutoUpdate).toBe(true);
  });

  it("keeps shadow settings apart", () => {
    const scene = new THREE.Scene();
    const wood = new THREE.MeshStandardMaterial();
    const casting = [box(wood, 0), box(wood, 1)];
    for (const mesh of casting) mesh.castShadow = true;
    scene.add(markStatic(new THREE.Group()).add(...casting, box(wood, 2), box(wood, 3)));
    const into = new THREE.Group();

    mergeStatic(scene, into);

    expect(into.children.map((mesh) => mesh.castShadow).sort()).toEqual([false, true]);
  });
});
