import type { Manifold } from "manifold-3d";
import {
  roundedRectangle,
  applySkadisHooks,
} from "./manifold";
import { textToCrossSection, emojiToCrossSection } from "./text";
import { EMOJI_PRESETS } from "./emoji";

// Tag dimensions (mm)
export const TAG_HEIGHT = 40;
export const TAG_DEFAULT_WIDTH = 80;
export const TAG_MIN_WIDTH = 40;
export const TAG_MAX_WIDTH = 160;
const TAG_BODY_DEPTH = 4;
const TAG_POCKET_DEPTH = 1.2;
const TAG_POCKET_INSET = 2;
const TAG_CORNER_RADIUS = 4;

const TAG_PLATE_BASE = 0.8;
const TAG_TEXT_HEIGHT = 0.8;
const TAG_PLATE_CLEARANCE = 0.15;

const TAG_TEXT_PADDING = 3;

export async function tagBody(width: number): Promise<Manifold> {
  // Main body: rounded rectangle in XY plane, extruded along Z
  // Cross-section: X = width, Y = depth
  let body = (
    await roundedRectangle([width, TAG_BODY_DEPTH], TAG_CORNER_RADIUS)
  ).extrude(TAG_HEIGHT);

  // Pocket on front face (+Y side)
  // Pocket dimensions: inset from each edge
  const pocketW = width - 2 * TAG_POCKET_INSET;
  const pocketH = TAG_HEIGHT - 2 * TAG_POCKET_INSET;

  // The pocket is a thin slab positioned on the +Y face of the body
  // Body goes from -depth/2 to +depth/2 in Y
  // Pocket should cut into the front face (+Y)
  const pocketYStart = TAG_BODY_DEPTH / 2 - TAG_POCKET_DEPTH;
  const pocket = (await roundedRectangle([pocketW, TAG_POCKET_DEPTH], 0))
    .extrude(pocketH)
    .translate([0, pocketYStart + TAG_POCKET_DEPTH / 2, TAG_POCKET_INSET]);

  body = body.subtract(pocket);

  // Apply SKÅDIS hooks on back face
  return applySkadisHooks(body, TAG_HEIGHT, width, TAG_BODY_DEPTH, TAG_CORNER_RADIUS);
}

export async function tagTextPlate(
  width: number,
  text: string,
  emojiId: string | null,
): Promise<Manifold> {
  // Plate dimensions: fits inside pocket with clearance
  const plateW = width - 2 * TAG_POCKET_INSET - 2 * TAG_PLATE_CLEARANCE;
  const plateH = TAG_HEIGHT - 2 * TAG_POCKET_INSET - 2 * TAG_PLATE_CLEARANCE;

  // Base plate: thin slab
  // Cross-section in XY: X = plateW, Y = TAG_PLATE_BASE
  let plate = (await roundedRectangle([plateW, TAG_PLATE_BASE], 0)).extrude(
    plateH,
  );

  // Area available for text/emoji
  const textAreaW = plateW - 2 * TAG_TEXT_PADDING;
  const textAreaH = plateH - 2 * TAG_TEXT_PADDING;

  if (textAreaW <= 0 || textAreaH <= 0) return plate;

  // Get the cross-section for text or emoji
  let cs = null;
  if (emojiId) {
    const preset = EMOJI_PRESETS.find((p) => p.id === emojiId);
    if (preset) {
      cs = await emojiToCrossSection(
        preset.svg,
        preset.viewBox,
        textAreaW,
        textAreaH,
      );
    }
  } else if (text.trim()) {
    cs = await textToCrossSection(text, textAreaW, textAreaH);
  }

  if (cs) {
    // Extrude the text cross-section in +Y direction
    // The cross-section is in XZ plane (text face), so we need to:
    // 1. Extrude in default Z direction to get thickness
    // 2. Rotate to align with +Y face
    const textSolid = cs.extrude(TAG_TEXT_HEIGHT);

    // textSolid is in XY cross-section extruded along Z
    // We need it on the +Y face of the plate
    // Plate is in XY cross-section (X=width, Y=depth) extruded along Z (height)
    // Text should protrude from +Y face
    // So we need the text cross-section in XZ plane, extruded along Y

    // Strategy: the cross-section is already in XY (X=width, Y=height)
    // After extrude(TAG_TEXT_HEIGHT) it's a slab from Z=0 to Z=TAG_TEXT_HEIGHT
    // We rotate -90° around X to make it go from Y=0 to Y=TAG_TEXT_HEIGHT
    // Then translate to position on front face

    const rotated = textSolid.rotate([-90, 0, 0]);
    const translated = rotated.translate([
      0,
      TAG_PLATE_BASE / 2, // Position at front face of plate base
      plateH / 2, // Center vertically
    ]);
    plate = plate.add(translated);
  }

  return plate;
}

export async function tagPreview(
  width: number,
  text: string,
  emojiId: string | null,
): Promise<Manifold> {
  const body = await tagBody(width);
  const plate = await tagTextPlate(width, text, emojiId);

  // Position plate inside the pocket
  // Pocket starts at Y = depth/2 - pocketDepth
  // Plate base center Y = pocket center = depth/2 - pocketDepth/2
  const plateY =
    TAG_BODY_DEPTH / 2 - TAG_POCKET_DEPTH + TAG_PLATE_BASE / 2;
  const positionedPlate = plate.translate([0, plateY, TAG_POCKET_INSET + TAG_PLATE_CLEARANCE]);

  return body.add(positionedPlate);
}
