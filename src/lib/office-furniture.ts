// Office view (fork): what furnishes each office, and how big each model is
// in real life. Pure placement on the floor plan; the scene loads the models
// (Kenney Furniture Kit, CC0, public/office/furniture) and puts them there.
import { DOOR_WIDTH, type OfficeDesk, type OfficeRoom } from "./office-layout";

/** Each model's real size along one axis, in metres; the rest scales along. */
export const FURNITURE = {
  chairDesk: { axis: "y", size: 1.05 },
  computerKeyboard: { axis: "x", size: 0.42 },
  computerMouse: { axis: "z", size: 0.11 },
  pottedPlant: { axis: "y", size: 1.15 },
  plantSmall1: { axis: "y", size: 0.32 },
  plantSmall2: { axis: "y", size: 0.32 },
  bookcaseOpenLow: { axis: "x", size: 1.2 },
  rugRectangle: { axis: "x", size: 1 },
  coatRackStanding: { axis: "y", size: 1.75 },
  trashcan: { axis: "y", size: 0.42 },
  loungeDesignSofa: { axis: "x", size: 2 },
  tableCoffee: { axis: "x", size: 1 },
  lampRoundTable: { axis: "y", size: 0.45 },
} as const satisfies Record<string, { axis: "x" | "y" | "z"; size: number }>;

export type FurnitureModel = keyof typeof FURNITURE;

/** One calm palette for every model, by the kit's material names: light oak,
 * grey wool, matte steel, a quiet green — instead of the kit's bright
 * defaults (a salmon rug, a sky-blue sofa). */
export const FURNITURE_PALETTE: Record<string, string> = {
  carpet: "#8b8e93",
  carpetDarker: "#6f7378",
  carpetBlue: "#5b6b80",
  carpetWhite: "#e6e3de",
  wood: "#c8a983",
  woodDark: "#8d6c4c",
  plant: "#4f8a4b",
  metal: "#d6d7da",
  metalMedium: "#b9bbbf",
  metalDark: "#2b2c2f",
  lamp: "#f3eadb",
};

export interface Placement {
  model: FurnitureModel;
  x: number;
  z: number;
  /** height of what it stands on (0 = the floor) */
  y?: number;
  /** rotation around y; 0 faces +z (the corridor) */
  rotY?: number;
  /** flat things laid to a size (a rug), in metres; overrides the scale */
  stretch?: { x: number; z: number };
}

/** the floor the door swings over stays free */
const DOOR_CLEAR = 1.1;
/** what stands against a wall keeps this far from it */
const WALL_GAP = 0.35;

/** One office's furnishings round its desk: a rug under the team's desk, a
 * plant in the back corner, a low bookcase on the back wall with a small plant
 * on it, a coat stand inside the door and a bin; the chief's office a sofa
 * and a coffee table. Nothing on the door's path. */
export function roomDecor(room: OfficeRoom, desk: OfficeDesk): Placement[] {
  const left = room.x - room.width / 2;
  const right = room.x + room.width / 2;
  const back = room.z - room.depth / 2;
  const front = room.z + room.depth / 2;
  const shared = desk.tables[0];
  const items: Placement[] = [];
  if (shared) {
    const rugX = Math.min(shared.width + 1.6, room.width - 2 * WALL_GAP);
    const rugZ = Math.min(shared.depth + 2.2, room.depth - 2 * WALL_GAP);
    items.push({ model: "rugRectangle", x: shared.x, z: shared.z, stretch: { x: rugX, z: rugZ } });
  }
  items.push({ model: "pottedPlant", x: left + 0.55, z: back + 0.55 });
  items.push({ model: "bookcaseOpenLow", x: right - 0.6 - WALL_GAP, z: back + 0.2 + WALL_GAP / 2 });
  items.push({ model: "plantSmall1", x: right - 0.35 - WALL_GAP, z: back + 0.2 + WALL_GAP / 2, y: 1.2 });
  // inside the door, on the side away from the chief's desk
  const doorSide = room.doorX + DOOR_WIDTH / 2 + 0.5;
  if (doorSide < right - WALL_GAP) items.push({ model: "coatRackStanding", x: Math.min(right - 0.45, doorSide + 0.2), z: front - 0.45 });
  items.push({ model: "trashcan", x: left + 0.45, z: front - 0.45 });
  if (room.hero) {
    items.push({ model: "loungeDesignSofa", x: right - 0.55 - WALL_GAP, z: room.z, rotY: -Math.PI / 2 });
    items.push({ model: "tableCoffee", x: right - 1.45 - WALL_GAP, z: room.z, rotY: -Math.PI / 2 });
  }
  return items;
}

/** Inside the office, clear of the desk's tables (a rug may lie under them)
 * and of the doorway. For tests and for the scene's own sanity. */
export function placementFits(item: Placement, room: OfficeRoom, desk: OfficeDesk): boolean {
  const inside = item.x > room.x - room.width / 2 && item.x < room.x + room.width / 2 && item.z > room.z - room.depth / 2 && item.z < room.z + room.depth / 2;
  if (!inside) return false;
  if (item.model === "rugRectangle") return true;
  // keep clear of the tables by the piece's own half-size, plus a gap
  const half = item.model === "tableCoffee" || item.model === "loungeDesignSofa" || item.model === "bookcaseOpenLow" ? FURNITURE[item.model].size / 2 : 0.25;
  const onTable = desk.tables.some((table) => Math.abs(item.x - table.x) < table.width / 2 + half + 0.2 && Math.abs(item.z - table.z) < table.depth / 2 + half + 0.2);
  const inDoor = Math.abs(item.x - room.doorX) < DOOR_WIDTH / 2 + 0.2 && room.z + room.depth / 2 - item.z < DOOR_CLEAR;
  return !onTable && !inDoor;
}
