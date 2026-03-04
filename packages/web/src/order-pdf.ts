import { jsPDF } from "jspdf";
import * as THREE from "three";
import type { Manifold } from "manifold-3d";
import { mesh2geometry } from "./model/export";
import type {
  Placement,
  GroupBBox,
} from "./model/export";
import { PRETENDARD_BASE64 } from "./fonts/pretendard-base64";

// ─── Font Registration ───

let fontRegistered = false;

function registerPretendard(doc: jsPDF) {
  if (!fontRegistered) {
    doc.addFileToVFS("Pretendard-Regular.ttf", PRETENDARD_BASE64);
    doc.addFont("Pretendard-Regular.ttf", "Pretendard", "normal");
    doc.addFont("Pretendard-Regular.ttf", "Pretendard", "bold");
    fontRegistered = true;
  }
  doc.setFont("Pretendard", "normal");
}

// ─── Colors (wedraw brand) ───
const COLOR_PRIMARY = "#36583D";
const COLOR_DARK = "#5A5A52";
const COLOR_NEUTRAL = "#B9B8AF";
const COLOR_LIGHT_BG = "#F4F4F2";

// ─── Offscreen Thumbnail Rendering ───

const thumbnailCache = new Map<string, string>();

/**
 * Render a Manifold model as an IKEA-style wireframe thumbnail (PNG data URL).
 * White body + dark edge lines, orthographic camera auto-fitted to bounding box.
 */
export function renderThumbnail(
  manifold: Manifold,
  cacheKey: string,
  size = 400,
): string {
  const cached = thumbnailCache.get(cacheKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    preserveDrawingBuffer: true,
    alpha: true,
    antialias: true,
  });
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();

  const geometry = mesh2geometry(manifold);
  geometry.computeVertexNormals();

  // White solid body
  const bodyMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const bodyMesh = new THREE.Mesh(geometry, bodyMat);
  scene.add(bodyMesh);

  // Dark edge lines (crease angle 30deg)
  const edges = new THREE.EdgesGeometry(geometry, 30);
  const lineMat = new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 1 });
  const lineSegments = new THREE.LineSegments(edges, lineMat);
  scene.add(lineSegments);

  // Auto-fit orthographic camera to bounding box
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox!;
  const center = new THREE.Vector3();
  bb.getCenter(center);
  const bbSize = new THREE.Vector3();
  bb.getSize(bbSize);

  const maxDim = Math.max(bbSize.x, bbSize.y, bbSize.z);
  const padding = maxDim * 0.15;
  const halfExtent = maxDim / 2 + padding;

  const camera = new THREE.OrthographicCamera(
    -halfExtent,
    halfExtent,
    halfExtent,
    -halfExtent,
    0.1,
    maxDim * 10,
  );

  // Isometric-ish view angle
  const dist = maxDim * 2;
  camera.position.set(
    center.x + dist * 0.7,
    center.y - dist * 0.5,
    center.z + dist * 0.6,
  );
  camera.up.set(0, 0, 1);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataUrl = canvas.toDataURL("image/png");

  // Cleanup
  geometry.dispose();
  bodyMat.dispose();
  edges.dispose();
  lineMat.dispose();
  renderer.dispose();

  thumbnailCache.set(cacheKey, dataUrl);
  return dataUrl;
}

// ─── Build Plate Layout Diagram ───

/**
 * Render a 2D top-down layout diagram of placements on build plates.
 */
export function renderBuildPlateLayout(
  placements: Placement[],
  bboxes: GroupBBox[],
  plateW: number,
  plateD: number,
): string {
  // Group placements by plate
  const plateMap = new Map<number, Placement[]>();
  for (const p of placements) {
    if (!plateMap.has(p.plate)) plateMap.set(p.plate, []);
    plateMap.get(p.plate)!.push(p);
  }

  const plateCount = plateMap.size;
  const cellW = 200;
  const cellH = 200;
  const margin = 20;
  const cols = Math.min(plateCount, 3);
  const rows = Math.ceil(plateCount / cols);

  const canvasW = cols * (cellW + margin) + margin;
  const canvasH = rows * (cellH + margin + 24) + margin;

  const canvas = document.createElement("canvas");
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvasW, canvasH);

  const sortedPlates = [...plateMap.entries()].sort((a, b) => a[0] - b[0]);

  for (let pi = 0; pi < sortedPlates.length; pi++) {
    const [plateNum, platePlacements] = sortedPlates[pi];
    const col = pi % cols;
    const row = Math.floor(pi / cols);

    const ox = margin + col * (cellW + margin);
    const oy = margin + row * (cellH + margin + 24);

    // Plate label
    ctx.fillStyle = COLOR_DARK;
    ctx.font = "bold 12px Helvetica, Arial, sans-serif";
    ctx.fillText(`Plate ${plateNum + 1}`, ox, oy + 12);

    const plateOy = oy + 20;

    // Plate background
    ctx.fillStyle = COLOR_LIGHT_BG;
    ctx.fillRect(ox, plateOy, cellW, cellH);

    // Dashed border
    ctx.strokeStyle = COLOR_NEUTRAL;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(ox, plateOy, cellW, cellH);
    ctx.setLineDash([]);

    // Scale factor
    const scaleX = cellW / plateW;
    const scaleY = cellH / plateD;
    const scale = Math.min(scaleX, scaleY);

    // Draw each placement
    for (const p of platePlacements) {
      const bb = bboxes[p.groupIndex];
      const rx = ox + p.tx * scale;
      const ry = plateOy + p.ty * scale;
      const rw = bb.width * scale;
      const rd = bb.depth * scale;

      // Filled rect
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(rx, ry, rw, rd);
      ctx.strokeStyle = COLOR_PRIMARY;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.strokeRect(rx, ry, rw, rd);

      // Number label
      ctx.fillStyle = COLOR_PRIMARY;
      ctx.font = "bold 11px Helvetica, Arial, sans-serif";
      const numLabel = `${p.groupIndex + 1}`;
      const tw = ctx.measureText(numLabel).width;
      ctx.fillText(numLabel, rx + rw / 2 - tw / 2, ry + rd / 2 + 4);
    }
  }

  return canvas.toDataURL("image/png");
}

// ─── PDF Generation ───

export interface OrderLineInfo {
  index: number;
  label: string;
  shape: "box" | "organizer" | "tag";
  snapshot: {
    shape: string;
    width: number;
    depth: number;
    height: number;
    radius: number;
    wall: number;
    bottom: number;
    cols: number;
    rows: number;
    tagText: string;
    tagEmoji: string | null;
  };
  quantity: number;
  thumbnailDataUrl: string;
}

export interface OrderPDFOptions {
  orderName: string;
  lines: OrderLineInfo[];
  placements: Placement[];
  bboxes: GroupBBox[];
  plateW: number;
  plateD: number;
  date: Date;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

function shapeLabel(shape: string): string {
  switch (shape) {
    case "box":
      return "BOX";
    case "organizer":
      return "GRID";
    case "tag":
      return "TAG";
    default:
      return shape.toUpperCase();
  }
}

function itemSpecLine(line: OrderLineInfo): string {
  const s = line.snapshot;
  if (s.shape === "tag") {
    const content = s.tagEmoji
      ? s.tagEmoji
      : `"${s.tagText || "blank"}"`;
    return `W ${s.width} mm  |  ${content}`;
  }
  if (s.shape === "organizer") {
    return `${s.width} x ${s.depth} x ${s.height} mm  |  ${s.cols + 1}x${s.rows + 1} cells`;
  }
  return `${s.width} x ${s.depth} x ${s.height} mm  |  R${s.radius} W${s.wall} B${s.bottom}`;
}

/**
 * Generate an IKEA-style A4 order summary PDF.
 */
export function generateOrderPDF(options: OrderPDFOptions): Blob {
  const { orderName, lines, placements, bboxes, plateW, plateD, date } =
    options;

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = 210;
  const marginL = 15;
  const marginR = 15;
  const contentW = pageW - marginL - marginR;

  let y = 20;

  // ─── Header ───
  doc.setFontSize(20);
  doc.setTextColor(COLOR_PRIMARY);
  registerPretendard(doc);

  doc.setFont("Pretendard", "bold");
  doc.text("PALAGG", marginL, y);

  doc.setFontSize(14);
  doc.setTextColor(COLOR_DARK);
  doc.setFont("Pretendard", "normal");
  doc.text("주문 내역서", marginL + 42, y);

  y += 10;
  doc.setFontSize(10);
  doc.setTextColor(COLOR_DARK);
  doc.text(`주문자: ${orderName || "-"}`, marginL, y);
  doc.text(`날짜: ${formatDate(date)}`, pageW - marginR - 40, y);

  y += 6;
  doc.setDrawColor(COLOR_NEUTRAL);
  doc.setLineWidth(0.3);
  doc.line(marginL, y, pageW - marginR, y);
  y += 8;

  // ─── Order Items ───
  const thumbSize = 32; // mm

  for (const line of lines) {
    // Check if we need a new page
    if (y + thumbSize + 10 > 270) {
      doc.addPage();
      y = 20;
    }

    // Shape type badge
    doc.setFontSize(8);
    doc.setFont("Pretendard", "bold");
    doc.setTextColor(COLOR_PRIMARY);
    doc.text(`■ ${shapeLabel(line.shape)}`, marginL, y);
    y += 5;

    // Thumbnail
    const imgX = marginL;
    const imgY = y;
    try {
      doc.addImage(
        line.thumbnailDataUrl,
        "PNG",
        imgX,
        imgY,
        thumbSize,
        thumbSize,
      );
    } catch {
      // If thumbnail fails, draw placeholder
      doc.setDrawColor(COLOR_NEUTRAL);
      doc.setFillColor(COLOR_LIGHT_BG);
      doc.rect(imgX, imgY, thumbSize, thumbSize, "FD");
    }

    // Text info (right of thumbnail)
    const textX = marginL + thumbSize + 6;

    doc.setFontSize(11);
    doc.setFont("Pretendard", "bold");
    doc.setTextColor(COLOR_DARK);
    const typeName =
      line.shape === "organizer" ? "Grid" : line.shape === "tag" ? "Tag" : "Box";
    doc.text(`#${line.index + 1}  PALAGG ${typeName}`, textX, imgY + 6);

    doc.setFontSize(9);
    doc.setFont("Pretendard", "normal");
    doc.setTextColor(COLOR_DARK);
    doc.text(itemSpecLine(line), textX, imgY + 13);

    doc.setFontSize(10);
    doc.setFont("Pretendard", "normal");
    doc.text(`수량: x${line.quantity}`, textX, imgY + 20);

    y = imgY + thumbSize + 6;
  }

  // ─── Build Plate Layout ───
  y += 4;
  if (y + 60 > 270) {
    doc.addPage();
    y = 20;
  }

  doc.setDrawColor(COLOR_NEUTRAL);
  doc.setLineWidth(0.3);
  doc.line(marginL, y, pageW - marginR, y);
  y += 8;

  doc.setFontSize(12);
  doc.setFont("Pretendard", "bold");
  doc.setTextColor(COLOR_PRIMARY);
  doc.text("빌드 플레이트 배치도", marginL, y);
  y += 6;

  // Render build plate diagram
  const layoutDataUrl = renderBuildPlateLayout(
    placements,
    bboxes,
    plateW,
    plateD,
  );
  const layoutImgW = Math.min(contentW, 120);
  const layoutImgH = layoutImgW * 0.6;

  if (y + layoutImgH + 10 > 270) {
    doc.addPage();
    y = 20;
  }

  try {
    doc.addImage(layoutDataUrl, "PNG", marginL, y, layoutImgW, layoutImgH);
  } catch {
    // fallback: skip image
  }
  y += layoutImgH + 8;

  // ─── Checklist ───
  if (y + lines.length * 8 + 40 > 270) {
    doc.addPage();
    y = 20;
  }

  doc.setDrawColor(COLOR_NEUTRAL);
  doc.setLineWidth(0.3);
  doc.line(marginL, y, pageW - marginR, y);
  y += 8;

  doc.setFontSize(12);
  doc.setFont("Pretendard", "bold");
  doc.setTextColor(COLOR_PRIMARY);
  doc.text("검수 체크리스트", marginL, y);
  y += 8;

  const totalQty = lines.reduce((sum, l) => sum + l.quantity, 0);

  for (const line of lines) {
    if (y + 8 > 280) {
      doc.addPage();
      y = 20;
    }

    // Checkbox square
    doc.setDrawColor(COLOR_DARK);
    doc.setLineWidth(0.4);
    doc.rect(marginL, y - 3.5, 4, 4);

    const typeName =
      line.shape === "organizer" ? "Grid" : line.shape === "tag" ? "Tag" : "Box";

    let dims: string;
    if (line.shape === "tag") {
      const content = line.snapshot.tagEmoji
        ? line.snapshot.tagEmoji
        : `"${line.snapshot.tagText || "blank"}"`;
      dims = `${line.snapshot.width} ${content}`;
    } else {
      dims = `${line.snapshot.width}x${line.snapshot.depth}x${line.snapshot.height}`;
    }

    doc.setFontSize(9);
    doc.setFont("Pretendard", "normal");
    doc.setTextColor(COLOR_DARK);
    doc.text(
      `#${line.index + 1}  PALAGG ${typeName} ${dims}`,
      marginL + 7,
      y,
    );

    doc.setFont("Pretendard", "bold");
    doc.text(`x${line.quantity}`, pageW - marginR - 15, y);

    y += 7;
  }

  y += 4;
  doc.setFontSize(10);
  doc.setFont("Pretendard", "bold");
  doc.setTextColor(COLOR_DARK);
  doc.text(`총 ${totalQty}개`, marginL, y);

  y += 10;
  doc.setFontSize(9);
  doc.setFont("Pretendard", "normal");
  doc.setTextColor(COLOR_NEUTRAL);
  doc.text("검수자: _______________    날짜: _______________", marginL, y);

  // ─── Footer ───
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFontSize(8);
    doc.setFont("Pretendard", "normal");
    doc.setTextColor(COLOR_NEUTRAL);
    doc.text("wedraw.kr", pageW / 2, 290, { align: "center" });
  }

  return doc.output("blob") as unknown as Blob;
}
