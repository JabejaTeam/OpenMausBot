// Office view (fork): the building around the desks — closed offices with a
// glass front on the corridor, the corridors, window walls on the outside,
// lamps — and the light, which follows the real sky over Brussels
// (lib/office-daylight). Walls between the camera and an office drop to a low
// rail, like a dollhouse, so every office stays in view from any angle.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { DOOR_WIDTH, type OfficeLayout, type OfficeRoom } from "@/lib/office-layout";
import type { Daylight } from "@/lib/office-daylight";
import { roomDecor } from "@/lib/office-furniture";
import { logoSize, NAME_MAX_HEIGHT, wallColorFor, wallSignFor, type TeamLook, type WallSign } from "@/lib/office-team-looks";
import type { FurnitureKit } from "./office-furniture-kit";

export const WALL_HEIGHT = 2.7;
const WALL_THICKNESS = 0.12;
/** a wall facing the camera drops to this */
const CUT_HEIGHT = 0.45;
const WINDOW_SILL = 0.9;
const WINDOW_HEAD = 2.45;
const MULLION_EVERY = 2.4;

interface Wall {
  mesh: THREE.Mesh;
  /** outward normal on the floor (x, z) */
  normal: THREE.Vector2;
  centre: THREE.Vector3;
}

export class OfficeBuilding {
  readonly group = new THREE.Group();
  readonly sun = new THREE.DirectionalLight("#ffffff", 2);
  private hemi = new THREE.HemisphereLight("#ffffff", "#444444", 1);
  private walls: Wall[] = [];
  private lamps: { light: THREE.PointLight; shade: THREE.MeshStandardMaterial }[] = [];
  /** per office: its walls' material, its back wall and its logo */
  private offices = new Map<string, { room: OfficeRoom; material: THREE.MeshStandardMaterial; backWall: THREE.Mesh; logo: THREE.Mesh | null; signKey?: string }>();
  private geometries: THREE.BufferGeometry[] = [];
  private environment: THREE.Texture;
  /** room floors, clickable: userData.deskId flies to that team */
  readonly floors: THREE.Mesh[] = [];
  private lampsOn = 0;

  private materials = {
    slab: new THREE.MeshStandardMaterial({ color: "#b9b6b0", roughness: 0.82 }),
    oak: new THREE.MeshStandardMaterial({ color: "#a98d6c", roughness: 0.7 }),
    ground: new THREE.MeshStandardMaterial({ color: "#3a3d40", roughness: 1 }),
    glass: new THREE.MeshStandardMaterial({ color: "#dbe8ef", roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false }),
    frame: new THREE.MeshStandardMaterial({ color: "#3b3f45", roughness: 0.4, metalness: 0.6 }),
    exterior: new THREE.MeshStandardMaterial({ color: "#e8e6e1", roughness: 0.9 }),
    sky: new THREE.MeshBasicMaterial({ color: "#cfe2f5" }),
  };

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    // soft, real reflections from a generic room — no file to load
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.environment;
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.radius = 5;
    this.sun.shadow.bias = -0.0004;
    scene.add(this.hemi, this.sun, this.sun.target, this.group);
  }

  private geo<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.push(geometry);
    return geometry;
  }

  /** Rebuild for a new floor plan, each office in its team's look. */
  build(layout: OfficeLayout, looks: Record<string, TeamLook>, kit?: FurnitureKit): void {
    this.clear();
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;

    const ground = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(600, 600)), this.materials.ground);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    const slab = new THREE.Mesh(this.geo(new THREE.BoxGeometry(width, 0.04, depth)), this.materials.slab);
    slab.position.set(cx, -0.02, cz);
    slab.receiveShadow = true;
    this.group.add(ground, slab);

    // the outside walls: window walls on three sides, the camera's side too
    // (it drops away when the camera looks over it)
    this.outerWall(minX, minZ, maxX, minZ, new THREE.Vector2(0, -1));
    this.outerWall(maxX, minZ, maxX, maxZ, new THREE.Vector2(1, 0));
    this.outerWall(minX, maxZ, minX, minZ, new THREE.Vector2(-1, 0));
    this.outerWall(maxX, maxZ, minX, maxZ, new THREE.Vector2(0, 1));

    layout.rooms.forEach((room, index) => {
      const wallColor = wallColorFor(room.id, index, looks);
      this.room(room, new THREE.MeshStandardMaterial({ color: wallColor, roughness: 0.92 }), wallSignFor(room.label, looks[room.id], wallColor));
      // furnished once the models are in (lib/office-furniture says where)
      const desk = layout.desks[index];
      if (kit && desk) for (const item of roomDecor(room, desk)) {
        const piece = kit.place(item);
        if (piece) this.group.add(piece);
      }
    });

    // the sun's shadows cover the whole building
    const half = Math.max(width, depth) / 2 + 4;
    this.sun.target.position.set(cx, 0, cz);
    Object.assign(this.sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 140 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.centre.set(cx, 0, cz);
    this.radius = half;
  }

  private centre = new THREE.Vector3();
  private radius = 20;

  /** A box wall from (x1,z1) to (x2,z2), its base on the floor. */
  private wall(x1: number, z1: number, x2: number, z2: number, height: number, material: THREE.Material, normal?: THREE.Vector2, y = 0): THREE.Mesh {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const geometry = this.geo(new THREE.BoxGeometry(length, 1, WALL_THICKNESS));
    geometry.translate(0, 0.5, 0);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
    mesh.rotation.y = -Math.atan2(z2 - z1, x2 - x1);
    mesh.scale.y = height;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    if (normal) this.walls.push({ mesh, normal, centre: mesh.position.clone().setY(height / 2) });
    return mesh;
  }

  private room(room: OfficeRoom, wallMaterial: THREE.MeshStandardMaterial, sign: WallSign): void {
    const left = room.x - room.width / 2;
    const right = room.x + room.width / 2;
    const back = room.z - room.depth / 2;
    const front = room.z + room.depth / 2;

    const floor = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(room.width, room.depth)), this.materials.oak);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(room.x, 0.004, room.z);
    floor.receiveShadow = true;
    floor.userData.deskId = room.id;
    this.floors.push(floor);
    this.group.add(floor);

    const backWall = this.wall(left, back, right, back, WALL_HEIGHT, wallMaterial, new THREE.Vector2(0, -1));
    this.offices.set(room.id, { room, material: wallMaterial, backWall, logo: null });
    this.setSign(room.id, sign);
    this.wall(left, front, left, back, WALL_HEIGHT, wallMaterial, new THREE.Vector2(-1, 0));
    this.wall(right, back, right, front, WALL_HEIGHT, wallMaterial, new THREE.Vector2(1, 0));

    // the glass front on the corridor, the door in it
    const doorLeft = room.doorX - DOOR_WIDTH / 2;
    const doorRight = room.doorX + DOOR_WIDTH / 2;
    for (const [from, to] of [[left, doorLeft], [doorRight, right]] as const) {
      if (to - from < 0.05) continue;
      const pane = new THREE.Mesh(this.geo(new THREE.BoxGeometry(to - from, WALL_HEIGHT, 0.02)), this.materials.glass);
      pane.position.set((from + to) / 2, WALL_HEIGHT / 2, front);
      this.group.add(pane);
    }
    for (const x of [left, doorLeft, doorRight, right]) {
      const post = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.05, WALL_HEIGHT, 0.07)), this.materials.frame);
      post.position.set(x, WALL_HEIGHT / 2, front);
      this.group.add(post);
    }
    const rail = new THREE.Mesh(this.geo(new THREE.BoxGeometry(room.width, 0.06, 0.07)), this.materials.frame);
    rail.position.set(room.x, WALL_HEIGHT - 0.03, front);
    const header = new THREE.Mesh(this.geo(new THREE.BoxGeometry(DOOR_WIDTH, 0.05, 0.07)), this.materials.frame);
    header.position.set(room.doorX, 2.1, front);
    this.group.add(rail, header);

    // a pendant lamp over the desk: warm light in the evening
    const shade = new THREE.MeshStandardMaterial({ color: "#f4efe6", emissive: "#ffcf96", emissiveIntensity: 0, roughness: 0.6 });
    const lampMesh = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.18, 0.32, 0.18, 24, 1, true)), shade);
    lampMesh.position.set(room.x, 2.25, room.z);
    const cord = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.008, 0.008, WALL_HEIGHT - 2.34, 6)), this.materials.frame);
    cord.position.set(room.x, (WALL_HEIGHT + 2.34) / 2, room.z);
    const light = new THREE.PointLight("#ffcf96", 0, Math.max(room.width, room.depth) * 1.2, 1.6);
    light.position.set(room.x, 2.1, room.z);
    this.group.add(lampMesh, cord, light);
    this.lamps.push({ light, shade });
  }

  /** A team's new look, without rebuilding the building. */
  applyLooks(layout: OfficeLayout, looks: Record<string, TeamLook>): void {
    layout.rooms.forEach((room, index) => {
      const office = this.offices.get(room.id);
      if (!office) return;
      const wallColor = wallColorFor(room.id, index, looks);
      office.material.color.set(wallColor);
      this.setSign(room.id, wallSignFor(room.label, looks[room.id], wallColor));
    });
  }

  /** The team's logo — or else its name — high on the inside of its back
   * wall, centred. */
  private setSign(roomId: string, sign: WallSign): void {
    const office = this.offices.get(roomId);
    const key = JSON.stringify(sign);
    if (!office || office.signKey === key) return;
    office.signKey = key;
    if (office.logo) {
      this.group.remove(office.logo);
      office.logo.geometry.dispose();
      const material = office.logo.material as THREE.MeshStandardMaterial;
      material.map?.dispose();
      material.dispose();
      office.logo = null;
    }
    const hang = (texture: THREE.Texture, aspect: number, maxHeight?: number) => {
      if (this.offices.get(roomId) !== office || office.signKey !== key) return texture.dispose();
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      const { width, height } = logoSize(aspect, office.room.width, maxHeight);
      const logo = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.6 }));
      // high on the wall, its top 15 cm under the ceiling line
      logo.position.set(office.room.x, WALL_HEIGHT - 0.15 - height / 2, office.room.z - office.room.depth / 2 + WALL_THICKNESS / 2 + 0.006);
      office.logo = logo;
      this.group.add(logo);
    };
    if (sign.kind === "logo") {
      new THREE.TextureLoader().load(sign.source, (texture) => {
        const image = texture.image as { width: number; height: number };
        hang(texture, image.width / Math.max(1, image.height));
      });
      return;
    }
    // the name as lettering on the wall: one line, bold, tightly cropped
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return;
    const font = '700 160px -apple-system, "SF Pro Display", "Inter", system-ui, sans-serif';
    context.font = font;
    canvas.width = Math.min(4096, Math.ceil(context.measureText(sign.text).width) + 16);
    canvas.height = 170;
    context.font = font;
    context.fillStyle = sign.color;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(sign.text, canvas.width / 2, canvas.height / 2 + 6, canvas.width - 16);
    hang(new THREE.CanvasTexture(canvas), canvas.width / canvas.height, NAME_MAX_HEIGHT);
  }

  /** An outside wall: solid below and above, windows between. */
  private outerWall(x1: number, z1: number, x2: number, z2: number, normal: THREE.Vector2): void {
    const length = Math.hypot(x2 - x1, z2 - z1);
    const along = new THREE.Vector2(x2 - x1, z2 - z1).normalize();
    this.wall(x1, z1, x2, z2, WINDOW_SILL, this.materials.exterior, normal);
    // the sky in the windows, and the head above them, drop with the sill
    const window = this.wall(x1, z1, x2, z2, WINDOW_HEAD - WINDOW_SILL, this.materials.sky, normal, WINDOW_SILL);
    window.castShadow = false;
    this.wall(x1, z1, x2, z2, WALL_HEIGHT - WINDOW_HEAD, this.materials.exterior, normal, WINDOW_HEAD);
    const count = Math.max(1, Math.round(length / MULLION_EVERY));
    for (let i = 0; i <= count; i += 1) {
      const at = (i / count) * length;
      this.wall(x1 + along.x * at - along.x * 0.03, z1 + along.y * at - along.y * 0.03, x1 + along.x * at + along.x * 0.03, z1 + along.y * at + along.y * 0.03, WINDOW_HEAD - WINDOW_SILL, this.materials.frame, normal, WINDOW_SILL);
    }
  }

  /** The sky now: sun, sky light, reflections, lamps, the view outside. */
  applyDaylight(light: Daylight, renderer: THREE.WebGLRenderer): void {
    this.scene.background = new THREE.Color(light.background);
    const fog = this.scene.fog as THREE.Fog | null;
    fog?.color.set(light.background);
    this.hemi.color.set(light.skyColor);
    this.hemi.groundColor.set(light.groundColor);
    this.hemi.intensity = light.hemiIntensity;
    this.sun.color.set(light.sunColor);
    this.sun.intensity = light.sunIntensity;
    // south is +z (the camera's side), west is -x; never below 8°, so its
    // shadows stay on the floor even at sunrise
    const altitude = Math.max(light.altitude, 8) * (Math.PI / 180);
    const direction = new THREE.Vector3(-Math.sin(light.azimuth) * Math.cos(altitude), Math.sin(altitude), Math.cos(light.azimuth) * Math.cos(altitude));
    this.sun.position.copy(this.centre).addScaledVector(direction, this.radius * 2.2);
    this.scene.environmentIntensity = light.envIntensity;
    renderer.toneMappingExposure = light.exposure;
    this.materials.sky.color.set(light.windowColor);
    this.materials.ground.color.set(light.groundColor);
    this.lampsOn = light.lamps;
    for (const lamp of this.lamps) {
      lamp.light.intensity = light.lamps * 9;
      lamp.shade.emissiveIntensity = light.lamps * 1.4;
    }
  }

  /** 0 by day, 1 at night: screens glow brighter in the dark. */
  get lampLevel(): number {
    return this.lampsOn;
  }

  /** Each frame: walls between the camera and an office drop to a rail;
   * window bands and heads above them fold away. */
  update(camera: THREE.Camera, deltaSeconds: number): void {
    const toCamera = new THREE.Vector2();
    const ease = 1 - Math.exp(-deltaSeconds * 8);
    for (const wall of this.walls) {
      toCamera.set(camera.position.x - wall.centre.x, camera.position.z - wall.centre.z).normalize();
      const full: number = wall.mesh.userData.full ?? (wall.mesh.userData.full = wall.mesh.scale.y);
      const raised = wall.mesh.position.y > 0;
      const facing = wall.normal.dot(toCamera) > 0.2;
      const target = facing ? (raised ? 0 : Math.min(full, CUT_HEIGHT)) : full;
      wall.mesh.scale.y += (target - wall.mesh.scale.y) * ease;
      wall.mesh.visible = wall.mesh.scale.y > 0.01;
    }
    // a logo goes with its wall when that drops away
    for (const office of this.offices.values()) {
      if (office.logo) office.logo.visible = office.backWall.scale.y > 0.9 * WALL_HEIGHT;
    }
  }

  private clear(): void {
    for (const office of this.offices.values()) {
      office.material.dispose();
      if (office.logo) {
        office.logo.geometry.dispose();
        const material = office.logo.material as THREE.MeshStandardMaterial;
        material.map?.dispose();
        material.dispose();
      }
    }
    this.offices.clear();
    this.group.clear();
    this.walls = [];
    this.floors.length = 0;
    for (const lamp of this.lamps) lamp.shade.dispose();
    this.lamps = [];
    for (const geometry of this.geometries.splice(0)) geometry.dispose();
  }

  dispose(): void {
    this.clear();
    for (const material of Object.values(this.materials)) material.dispose();
    this.environment.dispose();
    this.scene.environment = null;
  }
}
