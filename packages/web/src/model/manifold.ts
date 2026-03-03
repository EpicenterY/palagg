import type { Vec2, Vec3, CrossSection, Manifold } from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";
import init from "manifold-3d";
import manifold_wasm from "manifold-3d/manifold.wasm?url";

// NOTE: all values are in mm

export const CLIP_HEIGHT = 12;

// Load manifold 3d
export class ManifoldModule {
  private static wasm: ManifoldToplevel | undefined = undefined;
  static async get(): Promise<ManifoldToplevel> {
    if (this.wasm !== undefined) {
      return this.wasm;
    }

    this.wasm = await init({ locateFile: () => manifold_wasm });

    await this.wasm.setup();
    return this.wasm;
  }
}

// Generates a CCW arc (quarter)
function generateArc({
  center,
  radius,
}: {
  center: Vec2;
  radius: number;
}): Vec2[] {
  // Number of segments (total points - 2)
  const N_SEGMENTS = 24;
  const N_POINTS = N_SEGMENTS + 2;

  const pts: Vec2[] = [];
  for (let i = 0; i < N_POINTS; i++) {
    const angle = (i * (Math.PI / 2)) / (N_POINTS - 1);

    pts.push([
      center[0] + radius * Math.cos(angle),
      center[1] + radius * Math.sin(angle),
    ]);
  }

  return pts;
}

// Rounded rect centered at (0,0)
export async function roundedRectangle(
  size: Vec2,
  cornerRadius: number,
): Promise<CrossSection> {
  const { CrossSection } = await ManifoldModule.get();
  const w = size[0];
  const h = size[1];
  const basicArc = generateArc({
    center: [w / 2 - cornerRadius, h / 2 - cornerRadius],
    radius: cornerRadius,
  });

  // Reuse the basic arc and mirror & reverse as necessary for each corner of
  // the cube
  const topRight: Vec2[] = basicArc;
  const topLeft: Vec2[] = Array.from(basicArc.map(([x, y]) => [-x, y]));
  topLeft.reverse();
  const bottomLeft: Vec2[] = basicArc.map(([x, y]) => [-x, -y]);
  const bottomRight: Vec2[] = Array.from(basicArc.map(([x, y]) => [x, -y]));
  bottomRight.reverse();

  const vertices: Vec2[] = [
    ...topRight,
    ...topLeft,
    ...bottomLeft,
    ...bottomRight,
  ];

  return new CrossSection(vertices);
}

async function clipRCrossSection(): Promise<CrossSection> {
  const { CrossSection } = await ManifoldModule.get();

  const vertices: Vec2[] = [
    [0.95, 0],
    [2.45, 0],
    [2.45, 3.7],
    [3.05, 4.3],
    [3.05, 5.9],
    [2.45, 6.5],
    [0.95, 6.5],
    [0.95, 0],
  ];

  return new CrossSection(vertices).rotate(180);
}

// The skadis clips, starting at the origin and pointing in -Z
// If chamfer is true, the bottom of the clip has a 45 deg chamfer
// (to print without supports)
export async function clips(
  chamfer: boolean = false,
): Promise<[Manifold, Manifold]> {
  const clipR = (await clipRCrossSection()).extrude(CLIP_HEIGHT);
  const clipL = (await clipRCrossSection()).mirror([1, 0]).extrude(CLIP_HEIGHT);

  if (!chamfer) {
    return [clipR, clipL];
  }

  const n: Vec3 = [0, 1, 1]; /* a 45deg normal defining the trim plane */
  return [clipR.trimByPlane(n, 0), clipL.trimByPlane(n, 0)];
}

// The box (without clips) with origin in the middle of the bottom face
export async function base(
  height: number,
  width: number,
  depth: number,
  radius: number,
  wall: number,
  bottom: number,
): Promise<Manifold> {
  const innerRadius = Math.max(0, radius - wall);
  const outer = (await roundedRectangle([width, depth], radius)).extrude(
    height,
  );
  const innerNeg = (
    await roundedRectangle([width - 2 * wall, depth - 2 * wall], innerRadius)
  )
    .extrude(height - bottom)
    .translate([0, 0, bottom]);

  return outer.subtract(innerNeg);
}

const DIVIDER_THICKNESS = 1.5; // mm

export async function applySkadisHooks(
  model: Manifold,
  height: number,
  width: number,
  depth: number,
  radius: number,
  chamferAll: boolean = false,
): Promise<Manifold> {
  const padding = 5; /* mm */
  const W = width - 2 * radius - 2 * padding; // Working area
  const gw = 40; // (horizontal) gap between clip origins
  const N = Math.floor(W / gw + 1); // How many (pairs of) clips we can fit
  const M = N - 1;
  const dx = ((-1 * M) / 2) * gw; // where to place the clips

  // Same as horizontal, but vertically (slightly simpler because we always start
  // from 0 and we don't need to take the radius into account)
  const H = height - CLIP_HEIGHT; // Total height minus clip height
  const gh = 40;
  const NV = Math.floor(H / gh + 1);

  let result = model;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < NV; j++) {
      // For all but the first level, chamfer the clips (or all if chamferAll)
      const chamfer = chamferAll || j > 0;
      const [clipL, clipR] = await clips(chamfer);
      result = result.add(clipL.translate(i * gw + dx, -depth / 2, j * gh));
      result = result.add(clipR.translate(i * gw + dx, -depth / 2, j * gh));
    }
  }

  return result;
}

// Drawer organizer: hollow box with a grid of internal dividers, no clips
export async function drawerOrganizer(
  height: number,
  width: number,
  depth: number,
  radius: number,
  wall: number,
  bottom: number,
  cols: number, // number of vertical dividers → (cols+1) columns
  rows: number, // number of horizontal dividers → (rows+1) rows
  hookReferenceHeight: number = height,
): Promise<Manifold> {
  let result = await base(height, width, depth, radius, wall, bottom);

  const innerW = width - 2 * wall;
  const innerD = depth - 2 * wall;
  const divH = height - bottom;

  // Vertical dividers (split width into cols+1 sections)
  // translate() moves the center of the geometry, so x = center of divider in X
  const colSpacing = innerW / (cols + 1);
  for (let i = 1; i <= cols; i++) {
    const x = -innerW / 2 + i * colSpacing;
    const divider = (
      await roundedRectangle([DIVIDER_THICKNESS, innerD], 0)
    )
      .extrude(divH)
      .translate([x, 0, bottom]);
    result = result.add(divider);
  }

  // Horizontal dividers (split depth into rows+1 sections)
  // X center = 0 (box center), Y center = -innerD/2 + j * rowSpacing
  const rowSpacing = innerD / (rows + 1);
  for (let j = 1; j <= rows; j++) {
    const y = -innerD / 2 + j * rowSpacing;
    const divider = (
      await roundedRectangle([innerW, DIVIDER_THICKNESS], 0)
    )
      .extrude(divH)
      .translate([0, y, bottom]);
    result = result.add(divider);
  }

  return applySkadisHooks(result, hookReferenceHeight, width, depth, radius);
}

// The box (with clips), with origin where clips meet the box
export async function box(
  height: number,
  hookReferenceHeight: number,
  width: number,
  depth: number,
  radius: number,
  wall: number,
  bottom: number,
): Promise<Manifold> {
  let res = await base(height, width, depth, radius, wall, bottom);
  return applySkadisHooks(res, hookReferenceHeight, width, depth, radius);
}
