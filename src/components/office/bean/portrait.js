// Portrait studio: one small offscreen renderer that draws a bean's head and
// shoulders — colour, headgear, mood — into any 2D canvas (the panel avatar).
// Shared by every portrait; only portraits that move ask for new frames.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { AGENT_SCALE, BODY } from "./bean.js";
import { createAgent, createAgentMaterial, loadAgentTemplate, setExpression } from "./agent.js";
import { HeadgearInstancer } from "./headgear-instancer.js";

const SIZE = 160; // render size (px); portraits are drawn scaled into their canvas

let studio = null;
export function portraitStudio(url = "/office/bean.glb") {
  studio ??= create(url);
  return studio;
}

async function create(url) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404048, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2, 4, 5);
  scene.add(key);

  const kit = await loadAgentTemplate(url);
  const agent = createAgent(kit, "#8e8e93");
  agent.mesh.material = createAgentMaterial("#8e8e93"); // own copy: the colour is set per draw
  scene.add(agent.root);
  // a natural standing pose: the Idle clip's first frame
  const mixer = new THREE.AnimationMixer(agent.root);
  const idle = kit.clips.find((clip) => clip.name === "Idle");
  if (idle) { mixer.clipAction(idle).play(); mixer.setTime(0); }
  const headRest = agent.head.quaternion.clone();
  const headgear = new HeadgearInstancer(scene, { capacity: 1 });

  // head and shoulders, a little from the side
  const head = new THREE.Vector3(0, BODY.center[1] + BODY.half, 0).multiplyScalar(AGENT_SCALE); // head sphere centre
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(1.3, head.y + 0.5, 5.4);
  camera.lookAt(head.x, head.y + 0.05, head.z); // room above the head for its headgear

  const turn = new THREE.Quaternion(), euler = new THREE.Euler();
  /** Draw one frame into `canvas`. What to show is decided by the caller
   *  (lib/office-bean): expression, blink, head pitch, and `time` for headgear motion. */
  function draw(canvas, { color, headgear: piece, expression = "normal", blink = false, pitch = 0, time = 0 }) {
    agent.mesh.material.color.set(color);
    headgear.wear(agent, piece, color);
    setExpression(agent, expression, blink);
    agent.head.quaternion.copy(headRest).multiply(turn.setFromEuler(euler.set(pitch, 0, 0)));
    scene.updateMatrixWorld();
    headgear.update(time, 1 / 60);
    renderer.render(scene, camera);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
  }
  return { draw };
}
