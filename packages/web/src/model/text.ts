import type { Vec2, CrossSection } from "manifold-3d";
import opentype from "opentype.js";
import { ManifoldModule } from "./manifold";

const FONT_URL =
  "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/packages/pretendard/dist/public/static/Pretendard-Bold.otf";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fontCache: any;

async function loadFont(): Promise<any> {
  if (fontCache) return fontCache;
  fontCache = await opentype.load(FONT_URL);
  return fontCache;
}

// Tessellate a quadratic bezier curve into line segments
function tessellateQuadratic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  segments: number,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    pts.push([
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
    ]);
  }
  return pts;
}

// Tessellate a cubic bezier curve into line segments
function tessellateCubic(
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  segments: number,
): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    pts.push([
      mt * mt * mt * p0[0] +
        3 * mt * mt * t * p1[0] +
        3 * mt * t * t * p2[0] +
        t * t * t * p3[0],
      mt * mt * mt * p0[1] +
        3 * mt * mt * t * p1[1] +
        3 * mt * t * t * p2[1] +
        t * t * t * p3[1],
    ]);
  }
  return pts;
}

const BEZIER_SEGMENTS = 8;

// Convert opentype path commands to an array of contours (Vec2[][])
function pathToContours(commands: any[]): Vec2[][] {
  const contours: Vec2[][] = [];
  let current: Vec2[] = [];
  let cursor: Vec2 = [0, 0];

  for (const cmd of commands) {
    switch (cmd.type) {
      case "M":
        if (current.length > 0) contours.push(current);
        current = [[cmd.x, cmd.y]];
        cursor = [cmd.x, cmd.y];
        break;
      case "L":
        current.push([cmd.x, cmd.y]);
        cursor = [cmd.x, cmd.y];
        break;
      case "Q":
        current.push(
          ...tessellateQuadratic(
            cursor,
            [cmd.x1, cmd.y1],
            [cmd.x, cmd.y],
            BEZIER_SEGMENTS,
          ),
        );
        cursor = [cmd.x, cmd.y];
        break;
      case "C":
        current.push(
          ...tessellateCubic(
            cursor,
            [cmd.x1, cmd.y1],
            [cmd.x2, cmd.y2],
            [cmd.x, cmd.y],
            BEZIER_SEGMENTS,
          ),
        );
        cursor = [cmd.x, cmd.y];
        break;
      case "Z":
        if (current.length > 0) contours.push(current);
        current = [];
        break;
    }
  }

  if (current.length > 0) contours.push(current);
  return contours;
}

// Auto-fit text: find fontSize so text fits target height (width is unconstrained)
function autoFitFontSize(
  font: any,
  text: string,
  targetHeight: number,
): number {
  const testSize = 100;
  const path = font.getPath(text, 0, 0, testSize);
  const bb = path.getBoundingBox();
  const textH = bb.y2 - bb.y1;

  if (textH === 0) return testSize;

  return testSize * (targetHeight / textH);
}

/**
 * Measure the rendered width of text at a given target height (no geometry).
 */
export async function measureTextWidth(
  text: string,
  targetHeight: number,
): Promise<number> {
  if (!text.trim()) return 0;
  const font = await loadFont();
  const fontSize = autoFitFontSize(font, text, targetHeight);
  const path = font.getPath(text, 0, 0, fontSize);
  const bb = path.getBoundingBox();
  return bb.x2 - bb.x1;
}

export interface TextCrossSectionResult {
  cs: CrossSection;
  width: number;
}

export async function textToCrossSection(
  text: string,
  targetHeight: number,
): Promise<TextCrossSectionResult | null> {
  if (!text.trim()) return null;

  const font = await loadFont();
  const { CrossSection } = await ManifoldModule.get();

  const fontSize = autoFitFontSize(font, text, targetHeight);
  const path = font.getPath(text, 0, 0, fontSize);
  const contours = pathToContours(path.commands);

  if (contours.length === 0) return null;

  const bb = path.getBoundingBox();
  const cx = (bb.x1 + bb.x2) / 2;
  const cy = (bb.y1 + bb.y2) / 2;

  const centered = contours.map((contour) =>
    contour.map(([x, y]) => [x - cx, -(y - cy)] as Vec2),
  );

  return {
    cs: new CrossSection(centered, "NonZero"),
    width: bb.x2 - bb.x1,
  };
}

// Parse an SVG path d attribute into contours
function parseSvgPath(d: string): Vec2[][] {
  const contours: Vec2[][] = [];
  let current: Vec2[] = [];
  let cursor: Vec2 = [0, 0];
  let startPoint: Vec2 = [0, 0];
  let lastC2: Vec2 | null = null; // last cubic control point for S/s
  let lastQ1: Vec2 | null = null; // last quadratic control point for T/t

  // Tokenize: split into commands and numbers
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return contours;

  let i = 0;
  const num = () => parseFloat(tokens[i++]);

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(cmd)) {
      i++;
      // Reset control points for non-curve commands
      if (!"CcSs".includes(cmd)) lastC2 = null;
      if (!"QqTt".includes(cmd)) lastQ1 = null;

      switch (cmd) {
        case "M":
          if (current.length > 0) contours.push(current);
          cursor = [num(), num()];
          startPoint = cursor;
          current = [cursor];
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            cursor = [num(), num()];
            current.push(cursor);
          }
          break;
        case "m":
          if (current.length > 0) contours.push(current);
          cursor = [cursor[0] + num(), cursor[1] + num()];
          startPoint = cursor;
          current = [cursor];
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            cursor = [cursor[0] + num(), cursor[1] + num()];
            current.push(cursor);
          }
          break;
        case "L":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            cursor = [num(), num()];
            current.push(cursor);
          }
          break;
        case "l":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            cursor = [cursor[0] + num(), cursor[1] + num()];
            current.push(cursor);
          }
          break;
        case "H":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            cursor = [num(), cursor[1]];
            current.push(cursor);
          }
          break;
        case "h":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            cursor = [cursor[0] + num(), cursor[1]];
            current.push(cursor);
          }
          break;
        case "V":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            cursor = [cursor[0], num()];
            current.push(cursor);
          }
          break;
        case "v":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            cursor = [cursor[0], cursor[1] + num()];
            current.push(cursor);
          }
          break;
        case "C":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            const c1: Vec2 = [num(), num()];
            const c2: Vec2 = [num(), num()];
            const end: Vec2 = [num(), num()];
            current.push(...tessellateCubic(cursor, c1, c2, end, BEZIER_SEGMENTS));
            lastC2 = c2;
            cursor = end;
          }
          break;
        case "c":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            const c1: Vec2 = [cursor[0] + num(), cursor[1] + num()];
            const c2: Vec2 = [cursor[0] + num(), cursor[1] + num()];
            const end: Vec2 = [cursor[0] + num(), cursor[1] + num()];
            current.push(...tessellateCubic(cursor, c1, c2, end, BEZIER_SEGMENTS));
            lastC2 = c2;
            cursor = end;
          }
          break;
        case "S":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            const c1: Vec2 = lastC2
              ? [2 * cursor[0] - lastC2[0], 2 * cursor[1] - lastC2[1]]
              : cursor;
            const c2: Vec2 = [num(), num()];
            const end: Vec2 = [num(), num()];
            current.push(...tessellateCubic(cursor, c1, c2, end, BEZIER_SEGMENTS));
            lastC2 = c2;
            cursor = end;
          }
          break;
        case "s":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            const c1: Vec2 = lastC2
              ? [2 * cursor[0] - lastC2[0], 2 * cursor[1] - lastC2[1]]
              : cursor;
            const c2: Vec2 = [cursor[0] + num(), cursor[1] + num()];
            const end: Vec2 = [cursor[0] + num(), cursor[1] + num()];
            current.push(...tessellateCubic(cursor, c1, c2, end, BEZIER_SEGMENTS));
            lastC2 = c2;
            cursor = end;
          }
          break;
        case "Q":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            const c1: Vec2 = [num(), num()];
            const end: Vec2 = [num(), num()];
            current.push(...tessellateQuadratic(cursor, c1, end, BEZIER_SEGMENTS));
            lastQ1 = c1;
            cursor = end;
          }
          break;
        case "q":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            const c1: Vec2 = [cursor[0] + num(), cursor[1] + num()];
            const end: Vec2 = [cursor[0] + num(), cursor[1] + num()];
            current.push(...tessellateQuadratic(cursor, c1, end, BEZIER_SEGMENTS));
            lastQ1 = c1;
            cursor = end;
          }
          break;
        case "T":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            const c1: Vec2 = lastQ1
              ? [2 * cursor[0] - lastQ1[0], 2 * cursor[1] - lastQ1[1]]
              : cursor;
            const end: Vec2 = [num(), num()];
            current.push(...tessellateQuadratic(cursor, c1, end, BEZIER_SEGMENTS));
            lastQ1 = c1;
            cursor = end;
          }
          break;
        case "t":
          while (i < tokens.length && /^[-+.\d]/.test(tokens[i])) {
            const c1: Vec2 = lastQ1
              ? [2 * cursor[0] - lastQ1[0], 2 * cursor[1] - lastQ1[1]]
              : cursor;
            const end: Vec2 = [cursor[0] + num(), cursor[1] + num()];
            current.push(...tessellateQuadratic(cursor, c1, end, BEZIER_SEGMENTS));
            lastQ1 = c1;
            cursor = end;
          }
          break;
        case "Z":
        case "z":
          // Remove trailing duplicate of start point (zero-length closing edge)
          if (
            current.length > 1 &&
            current[current.length - 1][0] === current[0][0] &&
            current[current.length - 1][1] === current[0][1]
          ) {
            current.pop();
          }
          if (current.length > 0) contours.push(current);
          current = [];
          cursor = startPoint;
          break;
        default:
          break;
      }
    } else {
      i++; // Skip unexpected tokens
    }
  }

  if (current.length > 0) contours.push(current);
  return contours;
}

export async function emojiToCrossSection(
  svgPath: string,
  viewBox: [number, number, number, number],
  targetHeight: number,
  fillRule: "EvenOdd" | "NonZero" = "NonZero",
): Promise<TextCrossSectionResult | null> {
  const { CrossSection } = await ManifoldModule.get();

  const contours = parseSvgPath(svgPath);
  if (contours.length === 0) return null;

  const [vx, vy, vw, vh] = viewBox;
  const cx = vx + vw / 2;
  const cy = vy + vh / 2;

  // Scale to fit height only (width is unconstrained)
  const scale = targetHeight / vh;

  const transformed = contours.map((contour) =>
    contour.map(([x, y]) => [(x - cx) * scale, -(y - cy) * scale] as Vec2),
  );

  return {
    cs: new CrossSection(transformed, fillRule),
    width: vw * scale,
  };
}
