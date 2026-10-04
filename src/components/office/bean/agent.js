// Agent layer: loading the baked bean, its one material, its expressions.
// Everything an office (or the lab) needs to place agents goes through here.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { AGENT_SCALE, BODY } from "./bean.js";

// ---------- the one material ----------
/** Body, visor and eyes in one draw: the `_part` vertex attribute picks the look
 *  (body = this material's colour/clearcoat/sheen, visor = black glass, eyes =
 *  unlit white). One material per body colour, all sharing one shader program. */
const materials = new Map();
export function agentMaterial(color) {
  const key = new THREE.Color(color).getHexString();
  if (!materials.has(key)) materials.set(key, createAgentMaterial(color));
  return materials.get(key);
}

/** An unshared agent material (e.g. for a per-agent highlight); same program. */
export function createAgentMaterial(color) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.25, sheen: 0.4, sheenRoughness: 0.6 });
  m.name = "Agent";
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float _part;\nvarying float vPart;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvPart = _part;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vPart;")
      .replace("#include <color_fragment>", `#include <color_fragment>
        float visor = step(0.5, vPart) * (1.0 - step(1.5, vPart));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.006, 0.006, 0.008), visor);`)
      .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.08, visor);")
      .replace("#include <lights_physical_fragment>", `#include <lights_physical_fragment>
        material.clearcoatRoughness = mix(material.clearcoatRoughness, 0.06, visor);
        material.sheenColor *= 1.0 - visor;`)
      .replace("#include <dithering_fragment>", "#include <dithering_fragment>\nif (vPart > 1.5) gl_FragColor = vec4(1.0);");
  };
  m.customProgramCacheKey = () => "agent-v1";
  return m;
}

// ---------- template ----------
/** Loads bean.glb once. `headAnchor`: from the Head bone to the head sphere's
 *  centre in the rest pose — where headgear is built (accessories.js). */
export async function loadAgentTemplate(url = "bean.glb") {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  const template = gltf.scene;
  template.updateMatrixWorld(true);
  const head = template.getObjectByName("Head");
  const headAnchor = head.matrixWorld.clone().invert()
    .multiply(new THREE.Matrix4().makeTranslation(0, BODY.center[1] + BODY.half, 0));
  return { template, clips: gltf.animations, headAnchor };
}

/** A new agent (shares geometry with every other one). */
export function createAgent({ template, headAnchor }, color) {
  const root = clone(template);
  const mesh = root.getObjectByName("Bean");
  mesh.material = agentMaterial(color);
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere(); // bind pose, once; padded so every clip stays inside
  mesh.boundingSphere.radius *= 1.6;
  root.scale.setScalar(AGENT_SCALE);
  const head = root.getObjectByName("Head");
  const anchor = new THREE.Object3D(); // headgear sits here
  anchor.matrixAutoUpdate = false;
  anchor.matrix.copy(headAnchor);
  head.add(anchor);
  return { root, mesh, head, anchor, setColor: (c) => { mesh.material = agentMaterial(c); } };
}

// ---------- expressions ----------
export const EXPRESSIONS = ["normal", "happy", "surprised", "angry", "sad", "sleep"];
const MORPH = { surprised: "surprised", angry: "angry", sad: "sad", happy: "happy" };
/** Sets the eye morphs. Happy is exclusive (no blink on top of the arcs). */
export function setExpression(agent, expression, blinking = false) {
  const w = agent.mesh.morphTargetInfluences, index = agent.mesh.morphTargetDictionary;
  w.fill(0);
  if (MORPH[expression]) w[index[MORPH[expression]]] = 1;
  if (expression !== "happy" && (expression === "sleep" || blinking)) w[index.blink] = 1;
}
