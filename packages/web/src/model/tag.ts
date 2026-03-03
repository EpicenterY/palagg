import type { Manifold } from "manifold-3d";
import {
  CLIP_HEIGHT,
  roundedRectangle,
  applySkadisHooks,
} from "./manifold";
import { textToCrossSection, emojiToCrossSection } from "./text";
import { EMOJI_PRESETS } from "./emoji";

// Tag dimensions (mm)
export const TAG_PLATE_HEIGHT = 25;
const TAG_PLATE_DEPTH = 5;           // total plate depth
const TAG_TEXT_DEPTH = 0.4;          // text inlay depth on front face
const TAG_CLIP_CORNER_RADIUS = 0.5;  // nearly rectangular clip base
const TAG_INTERLOCK_DEPTH = 3;       // interlock tab/pocket depth

export const TAG_DEFAULT_WIDTH = 80;
export const TAG_MIN_WIDTH = 25;
export const TAG_MAX_WIDTH = 200;

const TAG_INTERLOCK_CHAMFER = 2; // 45° corner chamfer on clipBase (mm)
const TAG_TEXT_PADDING = 3;
const CLIP_BASE_MARGIN = 1.5;

const TAG_TEXT_V_PADDING = 3;     // vertical padding above/below content (mm)
const TAG_TEXT_AREA_HEIGHT = TAG_PLATE_HEIGHT - 2 * TAG_TEXT_V_PADDING; // 19mm

/** Max content width that fits within TAG_MAX_WIDTH plate. */
export const TAG_MAX_TEXT_CONTENT_WIDTH = (() => {
  const R = TAG_PLATE_HEIGHT / 2;
  const textHalfH = TAG_TEXT_AREA_HEIGHT / 2;
  const stadiumHPad = R - Math.sqrt(R * R - textHalfH * textHalfH) + TAG_TEXT_PADDING;
  return TAG_MAX_WIDTH - 2 * stadiumHPad;
})();

export { TAG_TEXT_AREA_HEIGHT };

/**
 * Compute clipBase width that fits inside the stadium plate outline.
 * At Z = CLIP_HEIGHT/2 from plate center, the stadium half-width is
 *   (W/2 - R) + sqrt(R² - (CLIP_HEIGHT/2)²)
 * We inset by CLIP_BASE_MARGIN from that edge.
 */
function clipBaseWidthFor(plateWidth: number): number {
  const R = TAG_PLATE_HEIGHT / 2;
  const clipHalfH = CLIP_HEIGHT / 2;
  const inset = R - Math.sqrt(R * R - clipHalfH * clipHalfH) + CLIP_BASE_MARGIN;
  return Math.max(0, plateWidth - 2 * inset);
}

/**
 * Clip base: rectangular body that attaches to SKÅDIS pegboard.
 * Height = CLIP_HEIGHT (12mm), depth = TAG_INTERLOCK_DEPTH (3mm tab).
 * Width is narrowed to fit inside the stadium plate outline.
 * Hooks are applied first, then translated so hooks center on plate center.
 */
export async function tagClipBase(width: number): Promise<Manifold> {
  const cbWidth = clipBaseWidthFor(width);
  // Cross-section in XY: X = cbWidth, Y = interlock tab depth (3mm)
  let clipBase = (
    await roundedRectangle([cbWidth, TAG_INTERLOCK_DEPTH], TAG_CLIP_CORNER_RADIUS)
  ).extrude(CLIP_HEIGHT);

  // Apply SKÅDIS hooks BEFORE translating (hooks at Y=-depth/2), no chamfer for tag
  clipBase = await applySkadisHooks(
    clipBase,
    CLIP_HEIGHT,
    cbWidth,
    TAG_INTERLOCK_DEPTH,
    TAG_CLIP_CORNER_RADIUS,
    false,
  );

  // 45° corner chamfer on clipBase edges (XZ plane)
  // trimByPlane normalizes the normal internally; offset is in normalized space.
  const SQRT2 = Math.sqrt(2);
  const half = cbWidth / 2;
  const topC = half + CLIP_HEIGHT - TAG_INTERLOCK_CHAMFER;
  const botC = half - TAG_INTERLOCK_CHAMFER;
  clipBase = clipBase.trimByPlane([-1, 0, -1], -topC / SQRT2); // top-right
  clipBase = clipBase.trimByPlane([1, 0, -1], -topC / SQRT2);  // top-left
  clipBase = clipBase.trimByPlane([-1, 0, 1], -botC / SQRT2);  // bottom-right
  clipBase = clipBase.trimByPlane([1, 0, 1], -botC / SQRT2);   // bottom-left

  // Translate so tab fits in plate pocket and hooks center on plate:
  //   Y: tab center at -(TAG_PLATE_DEPTH - TAG_INTERLOCK_DEPTH) / 2
  //      → tab Y ∈ [-TAG_PLATE_DEPTH/2, -TAG_PLATE_DEPTH/2 + TAG_INTERLOCK_DEPTH]
  //   Z: hook center (CLIP_HEIGHT/2) aligned with plate center (TAG_PLATE_HEIGHT/2)
  clipBase = clipBase.translate([
    0,
    -(TAG_PLATE_DEPTH - TAG_INTERLOCK_DEPTH) / 2,
    (TAG_PLATE_HEIGHT - CLIP_HEIGHT) / 2,
  ]);

  return clipBase;
}

export interface TagTextPlateResult {
  plate: Manifold;
  textFill: Manifold | null;
  actualWidth: number;
}

/**
 * Text plate: stadium-shaped plate with text/emoji cutout.
 * Plate centered at Y=0 (front Y=+D/2, back Y=-D/2).
 * Back has interlock pocket for clip base tab.
 * Text inlay on front face (TAG_TEXT_DEPTH deep).
 * If text is wider than userWidth, plate auto-widens.
 */
export async function tagTextPlate(
  userWidth: number,
  text: string,
  emojiId: string | null,
): Promise<TagTextPlateResult> {
  const textAreaH = TAG_TEXT_AREA_HEIGHT;

  // Get text/emoji cross-section (sized to fit height only)
  let textResult: { cs: import("manifold-3d").CrossSection; width: number } | null = null;

  if (emojiId) {
    const preset = EMOJI_PRESETS.find((p) => p.id === emojiId);
    if (preset) {
      textResult = await emojiToCrossSection(
        preset.svg,
        preset.viewBox,
        textAreaH,
        preset.fillRule,
      );
    }
  } else if (text.trim()) {
    textResult = await textToCrossSection(text, textAreaH);
  }

  // Compute actualWidth: auto-widen if content doesn't fit, clamp to [MIN, MAX]
  let actualWidth = userWidth;
  if (textResult) {
    const R = TAG_PLATE_HEIGHT / 2;
    const textHalfH = textAreaH / 2;
    const stadiumHPad = R - Math.sqrt(R * R - textHalfH * textHalfH) + TAG_TEXT_PADDING;
    const requiredWidth = textResult.width + 2 * stadiumHPad;
    actualWidth = Math.max(userWidth, requiredWidth);
    actualWidth = Math.min(actualWidth, TAG_MAX_WIDTH);
    actualWidth = Math.max(actualWidth, TAG_MIN_WIDTH);
    actualWidth = Math.ceil(actualWidth);
  }

  // Stadium cross-section: cornerRadius = height/2 → stadium (circle when width == height)
  const cs = await roundedRectangle(
    [actualWidth, TAG_PLATE_HEIGHT],
    TAG_PLATE_HEIGHT / 2,
  );

  // Extrude along Z (becomes depth Y after rotation)
  const extruded = cs.extrude(TAG_PLATE_DEPTH);

  // Rotate -90° around X: Y→Z, Z→-Y  (plate faces XZ plane)
  const rotated = extruded.rotate([-90, 0, 0]);

  // After rotation: Y ∈ [0, TAG_PLATE_DEPTH], Z ∈ [-H/2, +H/2]
  // Translate so plate is centered: Y ∈ [-D/2, +D/2], Z ∈ [0, H]
  let plate = rotated.translate([0, -TAG_PLATE_DEPTH / 2, TAG_PLATE_HEIGHT / 2]);

  // Back pocket for interlock (rectangular cutout matching clip base width)
  const cbWidth = clipBaseWidthFor(actualWidth);
  const pocketCs = await roundedRectangle([cbWidth, TAG_INTERLOCK_DEPTH], 0);
  let pocketSolid = pocketCs.extrude(CLIP_HEIGHT);

  // Apply same 45° corner chamfer as clipBase so pocket matches tab shape
  const SQRT2 = Math.sqrt(2);
  const pHalf = cbWidth / 2;
  const pTopC = pHalf + CLIP_HEIGHT - TAG_INTERLOCK_CHAMFER;
  const pBotC = pHalf - TAG_INTERLOCK_CHAMFER;
  pocketSolid = pocketSolid.trimByPlane([-1, 0, -1], -pTopC / SQRT2);
  pocketSolid = pocketSolid.trimByPlane([1, 0, -1], -pTopC / SQRT2);
  pocketSolid = pocketSolid.trimByPlane([-1, 0, 1], -pBotC / SQRT2);
  pocketSolid = pocketSolid.trimByPlane([1, 0, 1], -pBotC / SQRT2);

  // Position: Y ∈ [-D/2, -D/2 + INTERLOCK], Z centered on plate
  const pocket = pocketSolid.translate([
    0,
    -(TAG_PLATE_DEPTH - TAG_INTERLOCK_DEPTH) / 2,
    (TAG_PLATE_HEIGHT - CLIP_HEIGHT) / 2,
  ]);
  plate = plate.subtract(pocket);

  if (!textResult || textAreaH <= 0) {
    return { plate, textFill: null, actualWidth };
  }

  // Mirror Y to correct vertical flip from rotate([-90,0,0]),
  // mirror X so text reads correctly when viewed from front (180° Z rotation flips X).
  const correctedCs = textResult.cs.mirror([0, 1]).mirror([1, 0]);

  // Build text solid (TAG_TEXT_DEPTH deep on front face)
  const textExtruded = correctedCs.extrude(TAG_TEXT_DEPTH);
  const textRotated = textExtruded.rotate([-90, 0, 0]);
  // After rotation: Y ∈ [0, TAG_TEXT_DEPTH]
  // Position on front face: Y ∈ [+D/2 - TEXT_DEPTH, +D/2]
  let textSolid = textRotated.translate([
    0,
    TAG_PLATE_DEPTH / 2 - TAG_TEXT_DEPTH,
    TAG_PLATE_HEIGHT / 2,
  ]);

  // Safety: intersect text with plate to ensure no overflow past stadium boundary
  textSolid = textSolid.intersect(plate);

  // Subtract text from plate → cutout
  plate = plate.subtract(textSolid);

  return { plate, textFill: textSolid, actualWidth };
}

export interface TagPreviewResult {
  preview: Manifold;
  textFill: Manifold | null;
  actualWidth: number;
}

/**
 * Preview: clipBase + plate with cutout (text is NOT merged back).
 * textFill is returned separately for rendering as a filled black region.
 * clipBase uses actualWidth (may differ from userWidth if text auto-widened).
 */
export async function tagPreview(
  userWidth: number,
  text: string,
  emojiId: string | null,
): Promise<TagPreviewResult> {
  const { plate, textFill, actualWidth } = await tagTextPlate(userWidth, text, emojiId);
  const clipBase = await tagClipBase(actualWidth);

  // Don't add textFill — it's rendered as a separate black mesh in the viewer
  const preview = clipBase.add(plate);

  return { preview, textFill, actualWidth };
}
