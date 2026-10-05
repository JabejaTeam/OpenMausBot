// Office view (fork): the three.js scene — one desk per team, a robot per
// seat working at its monitor (three.js's RobotExpressive, CC0; see
// public/office/CREDITS.txt), tinted with the bot's colour. Imperative on purpose: React owns the
// overlays (names, panel), this owns the canvas. Loaded lazily, so three.js
// only ships to people who open the office.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { OfficeDesk, OfficeLayout, OfficeSeat } from "@/lib/office-layout";
import { mayWander, walkPath, WANDER_BUDGET_MS, wanderPlan } from "@/lib/office-wander";
import { Walker } from "./office-walker";
import { daylight } from "@/lib/office-daylight";
import { OfficeBuilding, WALL_HEIGHT } from "./office-building";
import type { TeamLook } from "@/lib/office-team-looks";
import { FurnitureKit } from "./office-furniture-kit";
import { advance, EASE_IN_OUT_CSS, easeInOut, glideShift, PANEL_MOVE_MS, progressOf } from "@/lib/office-motion";
import { linksOf, RECENT_HANDOFF_MS, type DelegationLink } from "@/lib/office-delegations";
import { beanMood, blinking, headgearFor, MOOD, WAITING_PITCH, workingMotion } from "@/lib/office-bean";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
// bean agent (preview): baked body + face, headgear instancing — see bean/*.js
// @ts-expect-error plain JS module (preview)
import { createAgentMaterial, setExpression } from "./bean/agent.js";
// @ts-expect-error plain JS module (preview)
import { HeadgearInstancer } from "./bean/headgear-instancer.js";
// @ts-expect-error plain JS module (preview)
import { BODY } from "./bean/bean.js";
// @ts-expect-error plain JS module (preview)
import { AdaptiveResolution, ShadowScheduler, warmUp } from "./bean/render-perf.js";

export interface OfficeBotLook {
  name: string;
  color: string;
  working: boolean;
  /** waiting on you (an approval or a question): beats working */
  waiting: boolean;
  unread: boolean;
  /** a chief (a team's PM, the hero) never leaves its desk */
  chief?: boolean;
}

/** The app's own colours for the status marks; the office's light comes
 * from the real sky (lib/office-daylight), not the app theme. */
export interface OfficeTheme {
  accent: string;
  success: string;
  warning: string;
}

interface Seat {
  botId: string;
  root: THREE.Group;
  /** the seated robot (absent until the model has loaded) */
  avatar: THREE.Object3D | null;
  mixer: THREE.AnimationMixer | null;
  headBone: THREE.Object3D | null;
  /** the head's seated pose; motion is set relative to it, never accumulated */
  headRest: THREE.Quaternion;
  /** the robot's body material, own per seat: carries colour and highlight */
  tint: THREE.MeshStandardMaterial;
  /** bean: its one mesh (eye morphs) and the headgear anchor on the head */
  agent: { mesh: THREE.SkinnedMesh; anchor: THREE.Object3D } | null;
  screen: THREE.Mesh;
  /** status above the head: faces the camera, keeps a minimum on-screen size */
  marker: THREE.Group;
  spinner: THREE.Object3D;
  alert: THREE.Sprite;
  dot: THREE.Sprite;
  phase: number;
  /** the robot and its hit area: what walks when the bot wanders */
  body: THREE.Group;
  walker: Walker | null;
  /** the marker's seated place; a walking bot's marker follows it */
  markerHome: THREE.Vector3;
  homeId: string;
  placed: OfficeSeat;
}

const DESK_HEIGHT = 0.75;
const reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
/** top of a seated robot's head; replaced by the measured value once loaded */
let HEAD_Y = 1.36;
const ROBOT_URL = "/office/bean.glb";
/** gap between the top of the head and the centre of the status marker */
const MARKER_GAP = 0.24;
/** the robot's standing height in metres */
const ROBOT_HEIGHT = 1.25;
/** where the seated robot's hips go: on the chair seat */
const HIPS_AT = { y: 0.52, z: -0.08 };

interface Robot {
  gltf: GLTF;
  sitting: THREE.AnimationClip;
  scale: number;
  offset: THREE.Vector3;
  /** top centre of the seated head, in seat space */
  headTop: THREE.Vector3;
  /** Head bone → centre of the bean's head sphere (rest pose): headgear anchor */
  headAnchor: THREE.Matrix4;
}

/** Measure the robot once: its scale, and how far to move it so that, at the
 * end of its Sitting clip, its hips rest on the chair. */
function prepareRobot(gltf: GLTF): Robot | null {
  const sitting = gltf.animations.find((clip) => clip.name === "Sitting");
  if (!sitting) return null;
  const probe = cloneSkinned(gltf.scene);
  const bone = (name: string) => {
    let found: THREE.Object3D | null = null;
    probe.traverse((node) => {
      if (!found && (node as THREE.Bone).isBone && node.name === name) found = node;
    });
    return found as THREE.Object3D | null;
  };
  const at = (name: string) => bone(name)?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  // bounding boxes of skinned meshes lie (bind pose, unit scale); measure bones
  probe.updateMatrixWorld(true);
  const standingHead = at("Head").y - Math.min(at("Foot.L").y, at("Foot.R").y);
  // the head bone sits at the neck; the head itself is about 0.3 of the height
  const scale = (ROBOT_HEIGHT * 0.7) / Math.max(1e-6, standingHead);
  // the bean's head is part of its one mesh: its top/centre are points on the Head bone
  const headBoneAtRest = bone("Head")!;
  const sphereCentre = new THREE.Vector3(0, BODY.center[1] + BODY.half, 0);
  const headTopLocal = headBoneAtRest.worldToLocal(sphereCentre.clone().setY(sphereCentre.y + BODY.radius));
  const headAnchor = headBoneAtRest.matrixWorld.clone().invert().multiply(new THREE.Matrix4().makeTranslation(sphereCentre));
  probe.scale.setScalar(scale);
  const mixer = new THREE.AnimationMixer(probe);
  const action = mixer.clipAction(sitting);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(sitting.duration);
  probe.updateMatrixWorld(true);
  const hips = at("Hips");
  const offset = new THREE.Vector3(-hips.x, HIPS_AT.y - hips.y, HIPS_AT.z - hips.z);
  // the head is a rigid mesh on its bone, so its box is exact: centre and top
  let headMesh: THREE.Object3D | null = null;
  probe.traverse((node) => {
    if (!headMesh && (node as THREE.Mesh).isMesh && node.name === "Head") headMesh = node;
  });
  let headTop: THREE.Vector3;
  if (headMesh) {
    const box = new THREE.Box3().setFromObject(headMesh);
    headTop = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2).add(offset);
  } else {
    headTop = headBoneAtRest.localToWorld(headTopLocal.clone()).add(offset);
  }
  HEAD_Y = headTop.y;
  return { gltf, sitting, scale, offset, headTop, headAnchor };
}

function screenTexture(accent: string): THREE.CanvasTexture {
  // a few soft "code" lines; scrolled while a bot works
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, 128, 256);
  let seed = 7;
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let y = 8; y < 256; y += 12) {
    const indent = Math.floor(rand() * 4) * 10;
    ctx.fillStyle = rand() > 0.7 ? accent : "rgba(255,255,255,0.55)";
    ctx.globalAlpha = 0.85;
    ctx.fillRect(10 + indent, y, 20 + rand() * 70, 4);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1, 0.5);
  return texture;
}

export class OfficeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.5, 400) // near ≥ 0.5: the camera stays ≥ 4 m away; more depth precision;
  private controls: OrbitControls;
  private clock = new THREE.Clock();
  private world = new THREE.Group();
  private seats = new Map<string, Seat>();
  private pickables: THREE.Object3D[] = [];
  private looks = new Map<string, OfficeBotLook>();
  private labels = new Map<string, HTMLElement>();
  private desks: OfficeDesk[] = [];
  private hoverLabel: HTMLElement | null = null;
  private hovered: string | null = null;
  /** the office under the pointer (its floor, or a bot of that team) */
  private hoveredRoom: string | null = null;
  /** pointing at the empty chair of a bot that is out walking */
  private hoveredChair = false;
  private hoveredAway = false;
  private selected: string | null = null;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private down: { x: number; y: number } | null = null;
  private flight: { from: THREE.Spherical; to: THREE.Spherical; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; elapsed: number; ms: number; shift?: { startX: number } } | null = null;
  /** The side panel over the canvas. This loop slides it, and shifts the
   * view by half of what it covers, on the same clock as the camera flight. */
  private panel: HTMLElement | null = null;
  private panelClosing: ReturnType<typeof setTimeout> | null = null;
  private returnView: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  private inset = 0;
  private resize: ResizeObserver;
  private building: OfficeBuilding;
  private daylightTimer: ReturnType<typeof setInterval>;
  private materials: {
    desk: THREE.MeshStandardMaterial;
    metal: THREE.MeshStandardMaterial;
    chair: THREE.MeshStandardMaterial;
    monitor: THREE.MeshStandardMaterial;
    screenIdle: THREE.MeshStandardMaterial;
    screenWorking: THREE.MeshStandardMaterial;
    alert: THREE.SpriteMaterial;
    dot: THREE.SpriteMaterial;
    busy: THREE.MeshBasicMaterial;
    hit: THREE.MeshBasicMaterial;
  };
  private screenMap: THREE.CanvasTexture;
  private geometries: THREE.BufferGeometry[] = [];

  constructor(
    private host: HTMLElement,
    theme: OfficeTheme,
    private events: { onHover: (botId: string | null, away: boolean) => void; onHoverRoom: (deskId: string | null) => void; onPick: (botId: string) => void; onPickDesk: (deskId: string) => void },
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    // pixel ratio up to 2, stepping down when frames run late (bean/render-perf)
    this.resolution = new AdaptiveResolution(this.renderer);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.style.touchAction = "none";
    host.appendChild(this.renderer.domElement);

    this.scene.fog = new THREE.Fog("#000000", 40, 110);

    this.screenMap = screenTexture(theme.accent);
    this.accent = theme.accent;
    this.arcMaterials.bead.color.set(theme.accent);
    this.materials = {
      // white oak tops, white steel, dark fabric: a modern office
      desk: new THREE.MeshStandardMaterial({ color: "#d8c3a2", roughness: 0.6 }),
      metal: new THREE.MeshStandardMaterial({ color: "#e4e4e6", roughness: 0.35, metalness: 0.4 }),
      chair: new THREE.MeshStandardMaterial({ color: "#2e2f33", roughness: 0.8 }),
      monitor: new THREE.MeshStandardMaterial({ color: "#1c1c1e", roughness: 0.4, metalness: 0.3 }),
      screenIdle: new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#1c2433", emissiveIntensity: 0.6, roughness: 0.2 }),
      screenWorking: new THREE.MeshStandardMaterial({ color: "#000000", emissive: "#ffffff", emissiveMap: this.screenMap, emissiveIntensity: 1.1, roughness: 0.2 }),
      // flat system-colour glyphs, like SF Symbols: no shading, no glow
      alert: new THREE.SpriteMaterial({ map: this.glyph(theme.warning, "!"), depthTest: false }),
      dot: new THREE.SpriteMaterial({ map: this.glyph(theme.accent), depthTest: false }),
      hit: new THREE.MeshBasicMaterial({ visible: false }),
      busy: new THREE.MeshBasicMaterial({ color: theme.success, depthTest: false }),
    };

    this.scene.add(this.world);
    // the building and its light, which follows the sky over Brussels
    this.building = new OfficeBuilding(this.scene, this.renderer);
    // shadows are re-drawn on demand (bean/render-perf): a new sun is a reason
    this.shadows = new ShadowScheduler(this.renderer);
    const sky = () => {
      this.building.applyDaylight(daylight(), this.renderer);
      this.shadows.invalidate();
    };
    sky();
    this.daylightTimer = setInterval(sky, 60_000);

    // Maps-like: drag pans the floor, right-drag (or two fingers) turns, scroll zooms
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 4;
    this.controls.maxDistance = 90;
    this.controls.minPolarAngle = 0.15;
    this.controls.maxPolarAngle = 1.3;
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    this.controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls.addEventListener("start", () => (this.flight = null));

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);

    this.resize = new ResizeObserver(() => this.fitCanvas());
    this.resize.observe(host);
    this.fitCanvas();
    this.renderer.setAnimationLoop(this.frame);

    void this.kit.load().then(() => {
      if (!this.disposed && this.layout) this.setLayout(this.layout, this.looks);
    });
    new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(ROBOT_URL)
      .then((gltf) => {
        if (this.disposed) return;
        this.robot = prepareRobot(gltf);
        if (this.layout) this.setLayout(this.layout, this.looks);
        void this.warmUp();
      })
      .catch(() => {
        // no model: the seats keep their invisible hit areas, labels still work
      });
  }

  private kit = new FurnitureKit();
  private teamLooks: Record<string, TeamLook> = {};

  /** Each team's wall colour and logo (server/team-looks). */
  setTeamLooks(looks: Record<string, TeamLook>): void {
    this.teamLooks = looks;
    if (this.layout) this.building.applyLooks(this.layout, looks);
  }
  private robot: Robot | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private headgear: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private resolution: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private shadows: any;

  /** Compile every shader and upload every headgear piece before they are first
   * seen, so neither a new bot nor a new piece hitches (bean/render-perf). */
  private async warmUp(): Promise<void> {
    const first = [...this.seats.values()].find((seat) => seat.agent)?.agent;
    if (!first || this.disposed) return;
    await warmUp(this.renderer, this.scene, this.camera, (on: boolean) => {
      if (on) { this.scene.updateMatrixWorld(); this.headgear.showAll(first); }
      else this.headgear.update(this.clock.elapsedTime, 0);
    });
  }
  private layout: OfficeLayout | null = null;
  private disposed = false;

  /** A tinted, seated robot for one seat. */
  private seatRobot(color: string): Pick<Seat, "avatar" | "mixer" | "headBone" | "headRest" | "tint" | "agent"> {
    const tint = createAgentMaterial(color) as THREE.MeshStandardMaterial;
    const robot = this.robot;
    if (!robot) return { avatar: null, mixer: null, headBone: null, headRest: new THREE.Quaternion(), tint, agent: null };
    const avatar = cloneSkinned(robot.gltf.scene);
    avatar.scale.setScalar(robot.scale);
    avatar.position.copy(robot.offset);
    let headBone: THREE.Object3D | null = null;
    avatar.traverse((node) => {
      if ((node as THREE.Bone).isBone && node.name === "Head") headBone = node;
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      // skinned bounds come from the bind pose; never cull a seated robot
      mesh.frustumCulled = false;
      mesh.material = tint; // the bean is one mesh, one material
    });
    const bean = avatar.getObjectByName("Bean") as THREE.SkinnedMesh;
    const anchor = new THREE.Object3D();
    anchor.matrixAutoUpdate = false;
    anchor.matrix.copy(robot.headAnchor);
    (headBone as THREE.Object3D | null)?.add(anchor);
    const mixer = new THREE.AnimationMixer(avatar);
    const action = mixer.clipAction(robot.sitting);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    mixer.setTime(robot.sitting.duration);
    const headRest = (headBone as THREE.Object3D | null)?.quaternion.clone() ?? new THREE.Quaternion();
    return { avatar, mixer, headBone, headRest, tint, agent: { mesh: bean, anchor } };
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  /** Rebuild desks and seats (only when the team layout changes). */
  setLayout(layout: OfficeLayout, looks: Map<string, OfficeBotLook>): void {
    const firstLayout = this.desks.length === 0;
    this.layout = layout;
    this.world.clear();
    for (const arc of this.arcs.values()) this.dropArc(arc);
    this.arcs.clear();
    for (const seat of this.seats.values()) {
      seat.tint.dispose();
      seat.mixer?.stopAllAction();
    }
    for (const geometry of this.geometries.splice(1)) geometry.dispose(); // keep the floor
    this.seats.clear();
    this.headgear ??= new HeadgearInstancer(this.scene);
    this.headgear.wearers.clear();
    this.pickables = [];
    this.desks = layout.desks;
    this.looks = looks;

    const legGeo = this.geo(new THREE.CylinderGeometry(0.03, 0.03, DESK_HEIGHT - 0.04, 12));
    const chairSeatGeo = this.geo(new RoundedBoxGeometry(0.55, 0.08, 0.5, 3, 0.03));
    const chairBackGeo = this.geo(new RoundedBoxGeometry(0.55, 0.55, 0.06, 3, 0.03));
    const chairPostGeo = this.geo(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 10));
    const monitorGeo = this.geo(new RoundedBoxGeometry(0.86, 0.52, 0.04, 3, 0.015));
    const screenGeo = this.geo(new THREE.PlaneGeometry(0.8, 0.46));
    const standGeo = this.geo(new THREE.BoxGeometry(0.05, 0.18, 0.05));
    const footGeo = this.geo(new THREE.BoxGeometry(0.24, 0.015, 0.16));
    // what a click or hover hits: a simple invisible shape, not the skinned robot
    const hitGeo = this.geo(new THREE.CapsuleGeometry(0.3, 0.7, 4, 8));
    const spinnerGeo = this.geo(new THREE.TorusGeometry(0.1, 0.02, 8, 40, Math.PI * 1.5));

    for (const desk of layout.desks) {
      const group = new THREE.Group();
      group.position.set(desk.x, 0, desk.z);
      // the team's shared desk, and the chief's own desk beside it
      for (const table of desk.tables) {
        const top = new THREE.Mesh(this.geo(new RoundedBoxGeometry(table.width, 0.05, table.depth, 4, 0.025)), this.materials.desk);
        top.position.set(table.x - desk.x, DESK_HEIGHT, table.z - desk.z);
        top.castShadow = true;
        top.receiveShadow = true;
        group.add(top);
        for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          const leg = new THREE.Mesh(legGeo, this.materials.metal);
          leg.position.set(top.position.x + lx * (table.width / 2 - 0.12), (DESK_HEIGHT - 0.04) / 2, top.position.z + lz * (table.depth / 2 - 0.12));
          leg.castShadow = true;
          group.add(leg);
        }
      }
      this.world.add(group);

      for (const placed of desk.seats) {
        const look = looks.get(placed.botId);
        const root = new THREE.Group();
        root.position.set(placed.x, 0, placed.z);
        root.rotation.y = placed.rotY;

        const chairSeat = new THREE.Mesh(chairSeatGeo, this.materials.chair);
        chairSeat.position.set(0, 0.45, -0.05);
        const chairBack = new THREE.Mesh(chairBackGeo, this.materials.chair);
        chairBack.position.set(0, 0.75, -0.3);
        const chairPost = new THREE.Mesh(chairPostGeo, this.materials.metal);
        chairPost.position.set(0, 0.22, -0.05);
        for (const part of [chairSeat, chairBack, chairPost]) part.castShadow = true;

        const robot = this.seatRobot(look?.color ?? "#8e8e93");
        const hit = new THREE.Mesh(hitGeo, this.materials.hit);
        hit.position.set(0, 0.95, 0);
        hit.userData.botId = chairBack.userData.botId = chairSeat.userData.botId = placed.botId;
        // the chair stays pointable while its bot is out walking: who sits here
        chairSeat.userData.seat = chairBack.userData.seat = true;

        // monitor on the desk, screen toward the bot
        const monitorZ = 0.9;
        const monitor = new THREE.Mesh(monitorGeo, this.materials.monitor);
        monitor.position.set(0, DESK_HEIGHT + 0.2 + 0.26, monitorZ);
        monitor.castShadow = true;
        const screen = new THREE.Mesh(screenGeo, look?.working ? this.materials.screenWorking : this.materials.screenIdle);
        screen.position.set(0, monitor.position.y, monitorZ - 0.022);
        screen.rotation.y = Math.PI;
        screen.userData.botId = placed.botId;
        const stand = new THREE.Mesh(standGeo, this.materials.metal);
        stand.position.set(0, DESK_HEIGHT + 0.11, monitorZ + 0.03);
        const foot = new THREE.Mesh(footGeo, this.materials.metal);
        foot.position.set(0, DESK_HEIGHT + 0.03, monitorZ + 0.03);

        // status over the head: "!" waiting on you, a spinner while working,
        // and a small blue dot beside either for unread
        const marker = new THREE.Group();
        // centred just above the head; the robot leans forward when it sits
        root.updateMatrixWorld();
        marker.position.copy(root.localToWorld((this.robot?.headTop.clone() ?? new THREE.Vector3(0, HEAD_Y, 0)).setY(HEAD_Y + MARKER_GAP)));
        marker.renderOrder = 10;
        const spinner = new THREE.Mesh(spinnerGeo, this.materials.busy);
        spinner.renderOrder = 10;
        const alert = new THREE.Sprite(this.materials.alert);
        alert.scale.setScalar(0.26);
        alert.renderOrder = 10;
        const dot = new THREE.Sprite(this.materials.dot);
        dot.scale.setScalar(0.11);
        dot.renderOrder = 11;
        marker.add(spinner, alert, dot);

        // the real chair, keyboard and mouse once the furniture is in;
        // until then the simple chair stands in
        const chair = this.kit.place({ model: "chairDesk", x: 0, z: -0.08 });
        if (chair) {
          const keyboard = this.kit.place({ model: "computerKeyboard", x: 0, z: 0.68, y: DESK_HEIGHT + 0.025 });
          const mouse = this.kit.place({ model: "computerMouse", x: 0.32, z: 0.7, y: DESK_HEIGHT + 0.025 });
          root.add(chair, ...[keyboard, mouse].filter((item): item is THREE.Object3D => Boolean(item)));
          // the simple chair stays as the real one's (unseen) hit area
          chairSeat.visible = chairBack.visible = false;
          root.add(chairSeat, chairBack);
        } else {
          root.add(chairSeat, chairBack, chairPost);
        }
        // the robot and its hit area move together when it goes for a walk
        const body = new THREE.Group();
        body.add(hit);
        if (robot.avatar) body.add(robot.avatar);
        root.add(body, monitor, screen, stand, foot);
        this.world.add(marker);
        this.world.add(root);
        this.pickables.push(hit, chairBack, chairSeat, screen);
        const walker = this.makeWalker(body, robot, root);
        const seat: Seat = { botId: placed.botId, root, ...robot, screen, marker, spinner, alert, dot, phase: Math.random() * Math.PI * 2, body, walker, markerHome: marker.position.clone(), homeId: desk.id, placed };
        this.showStatus(seat, look);
        if (seat.agent) this.headgear.wear(seat.agent, headgearFor(placed.botId, look?.chief), look?.color ?? "#8e8e93");
        this.seats.set(placed.botId, seat);
      }
    }

    this.shadows?.invalidate();
    // the offices round the desks; their floors fly you to the team
    this.building.build(layout, this.teamLooks, this.kit);
    this.pickables.push(...this.building.floors);
    if (firstLayout) this.fitAll(false);
    // seats moved: draw the arcs again between the new desks (no flash)
    this.syncArcs(false);
  }

  // ── delegation arcs ────────────────────────────────────────────────────
  // A soft arc from the bot that handed work over to the bot doing it; small
  // lights flow along it while the work goes on, and one bright light flies
  // across the moment a handoff appears. Which links exist is
  // lib/office-delegations; this only draws them.
  private accent = "#1084fe";
  private links: DelegationLink[] = [];
  private linksSeen = false;
  private arcs = new Map<string, { link: DelegationLink; curve: THREE.QuadraticBezierCurve3; tube: THREE.Mesh; tubeMaterial: THREE.MeshBasicMaterial; beads: THREE.Mesh[]; comet: THREE.Mesh; cometFrom: number | null }>();
  private arcGeometry = { bead: new THREE.SphereGeometry(0.065, 12, 8), comet: new THREE.SphereGeometry(0.13, 16, 12) };
  private arcMaterials = {
    bead: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.9, depthWrite: false }),
    comet: new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 1, depthWrite: false }),
  };

  setLinks(links: DelegationLink[]): void {
    this.links = links;
    // the links already there when the office opens appear quietly
    this.syncArcs(this.linksSeen);
    this.linksSeen = true;
  }

  /** In a handoff right now (either end): a bot talking stays at its desk,
   * and one out walking turns and walks back. */
  private talking(botId: string): boolean {
    const now = Date.now();
    return this.links.some((link) => (link.from === botId || link.to === botId) && (link.active || now - link.at < RECENT_HANDOFF_MS));
  }

  private syncArcs(flashNew: boolean): void {
    const wanted = new Map(this.links.map((link) => [link.id, link]));
    for (const [id, arc] of this.arcs) {
      if (wanted.has(id)) continue;
      this.dropArc(arc);
      this.arcs.delete(id);
    }
    for (const link of this.links) {
      const known = this.arcs.get(link.id);
      if (known) {
        // a new handoff on a pair already linked flashes too
        if (flashNew && link.at > known.link.at) known.cometFrom = performance.now();
        known.link = link;
        continue;
      }
      const start = new THREE.Vector3();
      const end = new THREE.Vector3();
      if (!this.arcEnd(link.from, start) || !this.arcEnd(link.to, end)) continue;
      const curve = new THREE.QuadraticBezierCurve3(start, new THREE.Vector3(), end);
      this.bend(curve);
      const tubeMaterial = new THREE.MeshBasicMaterial({ color: this.accent, transparent: true, opacity: 0, depthWrite: false });
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.026, 8, false), tubeMaterial);
      const beads = [0, 1, 2].map(() => {
        const bead = new THREE.Mesh(this.arcGeometry.bead, this.arcMaterials.bead);
        bead.visible = false;
        return bead;
      });
      const comet = new THREE.Mesh(this.arcGeometry.comet, this.arcMaterials.comet);
      comet.visible = false;
      this.world.add(tube, ...beads, comet);
      this.arcs.set(link.id, { link, curve, tube, tubeMaterial, beads, comet, cometFrom: flashNew ? performance.now() : null });
    }
  }

  /** Where an arc meets a bot: just over its head, wherever it is — at its
   * desk or out walking (the marker rides along with a walking bot). */
  private arcEnd(botId: string, target: THREE.Vector3): boolean {
    const seat = this.seats.get(botId);
    if (!seat) return false;
    target.copy(seat.marker.position).y += HEAD_Y + 0.05 - seat.markerHome.y;
    return true;
  }

  private bend(curve: THREE.QuadraticBezierCurve3): void {
    curve.v1.copy(curve.v0).lerp(curve.v2, 0.5).y += Math.max(1.6, curve.v0.distanceTo(curve.v2) * 0.45);
  }

  private arcFrom = new THREE.Vector3();
  private arcTo = new THREE.Vector3();

  private dropArc(arc: { tube: THREE.Mesh; tubeMaterial: THREE.MeshBasicMaterial; beads: THREE.Mesh[]; comet: THREE.Mesh }): void {
    this.world.remove(arc.tube, ...arc.beads, arc.comet);
    arc.tube.geometry.dispose();
    arc.tubeMaterial.dispose();
  }

  private drawArcs(time: number): void {
    const now = Date.now();
    const lit = linksOf(this.links, this.hovered ?? this.selected);
    for (const arc of this.arcs.values()) {
      const { link } = arc;
      // the arc stays between the two bots: one walking back to its desk
      // drags its end along
      if (this.arcEnd(link.from, this.arcFrom) && this.arcEnd(link.to, this.arcTo)
        && (this.arcFrom.distanceToSquared(arc.curve.v0) > 1e-4 || this.arcTo.distanceToSquared(arc.curve.v2) > 1e-4)) {
        arc.curve.v0.copy(this.arcFrom);
        arc.curve.v2.copy(this.arcTo);
        this.bend(arc.curve);
        arc.tube.geometry.dispose();
        arc.tube.geometry = new THREE.TubeGeometry(arc.curve, 64, 0.026, 8, false);
      }
      // a finished quick handoff fades out over what is left of its moment
      const fade = link.active ? 1 : Math.max(0, 1 - (now - link.at) / RECENT_HANDOFF_MS);
      const strength = lit.size ? (lit.has(link.id) ? 1 : 0.35) : 0.75;
      arc.tubeMaterial.opacity = 0.55 * fade * strength;
      arc.beads.forEach((bead, index) => {
        bead.visible = link.active && strength > 0.5;
        if (bead.visible) bead.position.copy(arc.curve.getPoint((time * 0.22 + index / 3) % 1));
      });
      if (arc.cometFrom !== null) {
        const t = (performance.now() - arc.cometFrom) / 1100;
        arc.comet.visible = t < 1;
        if (t < 1) arc.comet.position.copy(arc.curve.getPoint(easeInOut(Math.max(0, t))));
        else arc.cometFrom = null;
      }
    }
  }

  /** Cheap per-update changes: colour, working, unread. */
  setLooks(looks: Map<string, OfficeBotLook>): void {
    this.looks = looks;
    for (const seat of this.seats.values()) {
      const look = looks.get(seat.botId);
      if (!look) continue;
      seat.tint.color.set(look.color);
      if (seat.agent) this.headgear?.setColor(seat.agent, look.color);
      this.showStatus(seat, look);
    }
  }

  private showStatus(seat: Seat, look: OfficeBotLook | undefined): void {
    const waiting = Boolean(look?.waiting);
    const working = !waiting && Boolean(look?.working);
    seat.screen.material = look?.working ? this.materials.screenWorking : this.materials.screenIdle;
    seat.alert.visible = waiting;
    seat.spinner.visible = working;
    seat.dot.visible = Boolean(look?.unread);
    // alone, the dot takes the middle; beside a glyph it sits top right
    const beside = waiting || working;
    seat.dot.position.set(beside ? 0.13 : 0, beside ? 0.1 : 0, 0.01);
    seat.marker.visible = waiting || working || seat.dot.visible;
  }

  /** A filled circle in a system colour, optionally with a white glyph. */
  private glyph(color: string, text?: string): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(64, 64, 60, 0, Math.PI * 2);
    ctx.fill();
    if (text) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 88px -apple-system, BlinkMacSystemFont, 'SF Pro Rounded', system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 64, 68);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(texture);
    return texture;
  }

  /** A seat's walker, once the robot (and its clips) are in. */
  private makeWalker(body: THREE.Group, robot: Pick<Seat, "avatar" | "mixer">, seat: THREE.Object3D): Walker | null {
    const clips = this.robot?.gltf.animations ?? [];
    const clip = (name: string) => clips.find((item) => item.name === name);
    const [sitting, standing, walking, idle] = [clip("Sitting"), clip("Standing"), clip("Walking"), clip("Idle")];
    if (!robot.avatar || !robot.mixer || !sitting || !standing || !walking || !idle) return null;
    return new Walker(body, robot.avatar, robot.avatar.position.clone(), seat, this.world, robot.mixer, { sitting, standing, walking, idle, wave: clip("Wave") });
  }

  /** Idle bots go for a walk now and then (lib/office-wander); a chief, a
   * bot with work, one waiting on you or the one you opened stays or comes back. */
  private wander(seat: Seat, look: OfficeBotLook | undefined): void {
    const walker = seat.walker;
    if (!walker || !this.layout) return;
    const now = performance.now();
    const stay = !look || !mayWander({ chief: Boolean(look.chief), working: look.working, waiting: look.waiting }) || seat.botId === this.selected || this.talking(seat.botId) || reducedMotion();
    if (stay) walker.recall(now);
    else if (!walker.away) {
      const clock = Date.now();
      const plan = wanderPlan(seat.botId, clock, this.layout.rooms.map((room) => room.id), seat.homeId);
      if (plan && walker.walkedSlot !== plan.slot && clock >= plan.startAt && clock < plan.startAt + WANDER_BUDGET_MS) {
        walker.walkedSlot = plan.slot;
        walker.start(walkPath(this.layout, seat.placed, seat.homeId, plan.visit), now);
      }
    }
    walker.update(now, this.clockDeltaMs / 1000);
    // the status mark rides along over a walking bot's head
    if (walker.away) walker.position(seat.marker.position).setY(ROBOT_HEIGHT + MARKER_GAP + 0.1);
    else seat.marker.position.copy(seat.markerHome);
  }

  private textures: THREE.Texture[] = [];
  private toCamera = new THREE.Vector3();

  setSelected(botId: string | null): void {
    this.selected = botId;
  }

  /** Team labels (desk id → element) and the hover name, placed every frame. */
  setOverlays(labels: Map<string, HTMLElement>, hoverLabel: HTMLElement | null): void {
    this.labels = labels;
    this.hoverLabel = hoverLabel;
  }

  fitAll(animate = true): void {
    if (!this.layout || !this.desks.length) return;
    // the whole building, corridors and all
    const { minX, maxX, minZ, maxZ } = this.layout.bounds;
    // aim a little in front of the middle: perspective makes the near row bigger
    const target = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2 + (maxZ - minZ) * 0.06);
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    // seen from above at this angle the floor's depth shrinks by sin(elevation)
    const elevation = 0.95;
    const span = Math.max((maxX - minX) / (2 * Math.tan(hFov / 2)), ((maxZ - minZ) * Math.sin(elevation)) / (2 * Math.tan(vFov / 2)));
    const distance = Math.min(this.controls.maxDistance, Math.max(8, span * 1.25));
    const direction = new THREE.Vector3(0, Math.sin(elevation), Math.cos(elevation));
    this.flyTo(target.clone().addScaledVector(direction, distance), target, animate);
  }

  focusDesk(deskId: string): void {
    const desk = this.desks.find((item) => item.id === deskId);
    if (!desk) return;
    const target = new THREE.Vector3(desk.x, 0.6, desk.z);
    const distance = Math.max(7, desk.width * 1.1);
    const direction = new THREE.Vector3(0, Math.sin(0.75), Math.cos(0.75));
    this.flyTo(target.clone().addScaledVector(direction, distance), target, true);
  }

  focusBot(botId: string, ms?: number, withPanel = false): void {
    const seat = this.seats.get(botId);
    if (!seat) return;
    // where the bot is now: at its desk, or out in the corridor
    const target = seat.body.getWorldPosition(new THREE.Vector3()).setY(0.9);
    // keep the current viewing angle, just come closer
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.setLength(Math.min(offset.length(), 12));
    this.flyTo(target.clone().add(offset), target, true, ms, withPanel);
  }

  /** `withPanel`: the flight that opens the panel; the view's shift for the
   * panel follows this flight (lib/office-motion), not the faster slide. */
  private flyTo(position: THREE.Vector3, target: THREE.Vector3, animate: boolean, ms?: number, withPanel = false): void {
    if (!animate) {
      this.camera.position.copy(position);
      this.controls.target.copy(target);
      this.controls.update();
      return;
    }
    // swing around the target (radius and angles), never cut straight through
    const from = new THREE.Spherical().setFromVector3(this.camera.position.clone().sub(this.controls.target));
    const to = new THREE.Spherical().setFromVector3(position.clone().sub(target));
    if (to.theta - from.theta > Math.PI) to.theta -= 2 * Math.PI;
    else if (from.theta - to.theta > Math.PI) to.theta += 2 * Math.PI;
    const travel = this.controls.target.distanceTo(target) + Math.abs(from.radius - to.radius);
    // drop any drag momentum left from the click, or it shakes the flight
    const momentum = this.controls as unknown as { _sphericalDelta: THREE.Spherical; _panOffset: THREE.Vector3; _scale: number };
    momentum._sphericalDelta.set(0, 0, 0);
    momentum._panOffset.set(0, 0, 0);
    momentum._scale = 1;
    this.flight = {
      from,
      to,
      fromTarget: this.controls.target.clone(),
      toTarget: target,
      elapsed: 0,
      ms: ms ?? Math.min(1600, 900 + travel * 20),
      // where the target sits on screen now: the glide starts there
      shift: withPanel ? { startX: this.screenX(target) } : undefined,
    };
  }

  /** Slide the panel in (a CSS transform on the compositor) and fly to its
   * bot: one movement, same time and curve (lib/office-motion). */
  openPanel(panel: HTMLElement, botId: string): void {
    if (this.panelClosing) clearTimeout(this.panelClosing);
    this.panelClosing = null;
    // the view to come back to when the panel closes: the one before it
    // opened (reopening while it slides out keeps the first one)
    this.returnView ??= { position: this.camera.position.clone(), target: this.controls.target.clone() };
    this.panel = panel;
    this.slide(panel, "translateX(0)");
    this.focusBot(botId, reducedMotion() ? 0 : PANEL_MOVE_MS, true);
  }

  closePanel(onClosed: () => void): void {
    const panel = this.panel;
    if (!panel) return onClosed();
    this.slide(panel, "translateX(100%)");
    // zoom back out to where you were, with the slide: one movement
    const back = this.returnView;
    this.returnView = null;
    if (back) this.flyTo(back.position, back.target, true, reducedMotion() ? 0 : PANEL_MOVE_MS);
    if (this.panelClosing) clearTimeout(this.panelClosing);
    this.panelClosing = setTimeout(() => {
      this.panelClosing = null;
      this.panel = null;
      onClosed();
    }, reducedMotion() ? 0 : PANEL_MOVE_MS);
  }

  private slide(panel: HTMLElement, transform: string): void {
    // the flight's own time and curve (lib/office-motion): one movement
    panel.style.transition = reducedMotion() ? "none" : `transform ${PANEL_MOVE_MS}ms ${EASE_IN_OUT_CSS}`;
    panel.style.transform = transform;
  }

  private fitCanvas(): void {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.renderer.domElement.style.width = `${width}px`;
    this.renderer.domElement.style.height = `${height}px`;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // a resize clears the canvas; draw now so it never flashes empty
    this.renderer.render(this.scene, this.camera);
  }

  private pick(event: PointerEvent): THREE.Object3D | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    // a bot wins over the floor pad under it
    return hits.find((hit) => hit.object.userData.botId)?.object ?? hits[0]?.object ?? null;
  }

  private onPointerMove = (event: PointerEvent) => {
    if (event.buttons) return;
    const hit = this.pick(event);
    const botId: string | null = hit?.userData.botId ?? null;
    this.renderer.domElement.style.cursor = hit ? "pointer" : "grab";
    const away = Boolean(botId && this.seats.get(botId)?.walker?.away);
    this.hoveredChair = away && Boolean(hit?.userData.seat);
    if (botId !== this.hovered || away !== this.hoveredAway) {
      this.hovered = botId;
      this.hoveredAway = away;
      this.events.onHover(botId, away);
    }
    const roomId: string | null = hit?.userData.deskId ?? (botId ? this.seats.get(botId)?.homeId ?? null : null);
    if (roomId !== this.hoveredRoom) {
      this.hoveredRoom = roomId;
      this.events.onHoverRoom(roomId);
    }
  };

  private onPointerDown = (event: PointerEvent) => {
    this.down = { x: event.clientX, y: event.clientY };
    this.renderer.domElement.style.cursor = "grabbing";
  };

  private onPointerUp = (event: PointerEvent) => {
    const down = this.down;
    this.down = null;
    this.renderer.domElement.style.cursor = "grab";
    if (!down || event.button !== 0 || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    const hit = this.pick(event);
    if (hit?.userData.botId) this.events.onPick(hit.userData.botId);
    else if (hit?.userData.deskId) this.events.onPickDesk(hit.userData.deskId);
  };

  private onPointerLeave = () => {
    if (this.hoveredRoom !== null) {
      this.hoveredRoom = null;
      this.events.onHoverRoom(null);
    }
    if (this.hovered === null) return;
    this.hovered = null;
    this.hoveredAway = this.hoveredChair = false;
    this.events.onHover(null, false);
  };

  private project = new THREE.Vector3();

  private place(element: HTMLElement, x: number, y: number, z: number): void {
    this.project.set(x, y, z).project(this.camera);
    const visible = this.project.z < 1 && Math.abs(this.project.x) < 1.2 && Math.abs(this.project.y) < 1.2;
    element.style.visibility = visible ? "visible" : "hidden";
    if (!visible) return;
    const px = ((this.project.x + 1) / 2) * this.host.clientWidth;
    const py = ((1 - this.project.y) / 2) * this.host.clientHeight;
    element.style.transform = `translate(${px}px, ${py}px) translate(-50%, -100%)`;
  }

  private headTurn = new THREE.Quaternion();
  private headEuler = new THREE.Euler();

  /** Head pose = seated pose × a small nod (x) and turn (y), in radians. */
  private turnHead(seat: Seat, nod: number, turn: number): void {
    if (!seat.headBone) return;
    this.headTurn.setFromEuler(this.headEuler.set(nod, turn, 0));
    seat.headBone.quaternion.copy(seat.headRest).multiply(this.headTurn);
  }

  private clockDeltaMs = 0;

  /** A world point's on-screen x, with the camera as it is now. */
  private screenX(point: THREE.Vector3): number {
    this.camera.updateMatrixWorld();
    const projected = this.project.copy(point).project(this.camera);
    return ((projected.x + 1) / 2) * this.host.clientWidth;
  }

  private frame = () => {
    const raw = this.clock.getDelta();
    this.clockDeltaMs = raw * 1000;
    const delta = Math.min(raw, 0.1);
    const time = this.clock.elapsedTime;
    const { clientWidth: width, clientHeight: height } = this.host;
    // every move advances by capped frames, never by wall time (lib/office-motion)
    let eased = 1;
    let progress = 1;
    if (this.flight) {
      this.flight.elapsed = advance(this.flight.elapsed, this.clockDeltaMs);
      progress = progressOf(this.flight.elapsed, this.flight.ms);
      eased = easeInOut(progress);
    }
    // camera first, then the view's shift for the panel, solved against it
    const flight = this.flight;
    if (flight) {
      const { from, to, fromTarget, toTarget } = flight;
      this.controls.target.lerpVectors(fromTarget, toTarget, eased);
      const orbit = new THREE.Spherical(
        THREE.MathUtils.lerp(from.radius, to.radius, eased),
        THREE.MathUtils.lerp(from.phi, to.phi, eased),
        THREE.MathUtils.lerp(from.theta, to.theta, eased),
      );
      this.camera.position.setFromSpherical(orbit).add(this.controls.target);
      this.camera.lookAt(this.controls.target);
      if (progress === 1) this.flight = null;
    } else {
      this.controls.update();
    }
    // the view shifts by half of what the panel covers (a panel as wide as
    // the canvas, on phones, covers it: nothing to shift)
    let inset = 0;
    if (this.panel && this.panel.offsetWidth < width) {
      const full = this.panel.offsetWidth;
      if (flight?.shift) {
        // where the camera alone puts the target, then the glide (lib/office-motion)
        this.camera.clearViewOffset();
        const cameraX = this.screenX(flight.toTarget);
        inset = glideShift(cameraX, flight.shift.startX, (width - full) / 2, eased, full);
        this.inset = -1; // force the offset to be set again below
      } else {
        const covered = this.host.getBoundingClientRect().right - this.panel.getBoundingClientRect().left;
        inset = Math.round(THREE.MathUtils.clamp(covered, 0, full));
      }
    }
    if (inset !== this.inset) {
      this.inset = inset;
      if (inset > 0 && width && height) this.camera.setViewOffset(width, height, inset / 2, 0, width, height);
      else this.camera.clearViewOffset();
    }
    // fog only softens what lies beyond the office, at any zoom
    const fog = this.scene.fog as THREE.Fog;
    const distance = this.camera.position.distanceTo(this.controls.target);
    fog.near = distance * 1.6;
    fog.far = distance * 4;

    this.screenMap.offset.y = (this.screenMap.offset.y + delta * 0.12) % 1;
    this.drawArcs(time);
    let animating = this.building.update(this.camera, delta) || Boolean(this.flight);
    // screens light up more in the evening
    this.materials.screenWorking.emissiveIntensity = 1 + this.building.lampLevel * 0.5;
    for (const seat of this.seats.values()) {
      const look = this.looks.get(seat.botId);
      const lit = seat.botId === this.hovered || seat.botId === this.selected;
      seat.tint.emissive.set(lit ? "#ffffff" : "#000000");
      seat.tint.emissiveIntensity = seat.botId === this.hovered ? 0.22 : lit ? 0.12 : 0;
      this.wander(seat, look);
      // the seated pose is static (set once); small motion goes on top of it
      if (seat.avatar && !seat.walker?.away) {
        const base = this.robot?.offset.y ?? 0;
        if (look?.waiting) {
          // waiting on you: turn round and look at you
          const local = seat.root.worldToLocal(this.toCamera.copy(this.camera.position));
          const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -1, 1);
          seat.avatar.position.y = base;
          this.turnHead(seat, WAITING_PITCH, yaw);
        } else if (look?.working) {
          // typing: a small quick bob and a nod at the screen
          const { bob, pitch } = workingMotion(time, seat.phase);
          seat.avatar.position.y = base + bob;
          this.turnHead(seat, pitch, 0);
        } else {
          // idle: frozen (lib/office-bean MOOD) — nothing moves until there is work
          seat.avatar.position.y = base;
          this.turnHead(seat, 0, 0);
        }
      }
      if (seat.marker.visible) {
        seat.marker.quaternion.copy(this.camera.quaternion);
        if (seat.spinner.visible) seat.spinner.rotation.z = -time * 6;
        // waiting on you breathes, slowly, so it reads as calm but asking
        if (seat.alert.visible) seat.alert.scale.setScalar(0.26 * (1 + Math.sin(time * 3) * 0.06));
      }
    }

    // bean: eyes show the status; headgear follows the (now final) head poses
    for (const seat of this.seats.values()) {
      if (!seat.agent) continue;
      const mood = MOOD[beanMood(this.looks.get(seat.botId))];
      if (mood.moves || seat.walker?.away) animating = true;
      setExpression(seat.agent, mood.expression, mood.blinks && blinking(time, seat.phase));
    }
    this.scene.updateMatrixWorld();
    this.headgear?.update(time, delta);
    this.shadows.tick(animating);
    this.resolution.tick(this.clockDeltaMs);

    this.renderer.render(this.scene, this.camera);

    for (const desk of this.desks) {
      const label = this.labels.get(desk.id);
      // the team's name over its office door
      const room = this.layout?.rooms.find((item) => item.id === desk.id);
      if (label && room) this.place(label, room.doorX, WALL_HEIGHT + 0.25, room.z + room.depth / 2);
    }
    if (this.hoverLabel) {
      const seat = this.hovered ? this.seats.get(this.hovered) : null;
      // over the empty chair you point at, else over the bot wherever it is
      const at = this.hoveredChair ? seat?.markerHome : seat?.marker.position;
      if (seat && at) this.place(this.hoverLabel, at.x, HEAD_Y + MARKER_GAP + 0.25, at.z);
      else this.hoverLabel.style.visibility = "hidden";
    }
  };

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resize.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.controls.dispose();
    this.disposed = true;
    for (const seat of this.seats.values()) {
      seat.tint.dispose();
      seat.mixer?.stopAllAction();
    }
    this.robot?.gltf.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const material of [mesh.material].flat()) material.dispose();
    });
    for (const material of Object.values(this.materials)) material.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    this.screenMap.dispose();
    for (const texture of this.textures) texture.dispose();
    clearInterval(this.daylightTimer);
    this.building.dispose();
    this.kit.dispose();
    for (const arc of this.arcs.values()) this.dropArc(arc);
    this.arcGeometry.bead.dispose();
    this.arcGeometry.comet.dispose();
    this.arcMaterials.bead.dispose();
    this.arcMaterials.comet.dispose();
    this.renderer.dispose();
    canvas.remove();
  }
}
