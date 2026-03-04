import { jsPDF } from "jspdf";
import * as THREE from "three";
import type { Manifold } from "manifold-3d";
import { mesh2geometry } from "./model/export";
import { WEDRAW_LOGO_BASE64, WEDRAW_LOGO_W, WEDRAW_LOGO_H } from "./fonts/wedraw-logo-base64";

// ─── Font (loaded at runtime for Korean support) ───

let fontCacheRegular: string | null = null;
let fontCacheBold: string | null = null;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function loadFonts(): Promise<{ regular: string; bold: string }> {
  if (fontCacheRegular && fontCacheBold) {
    return { regular: fontCacheRegular, bold: fontCacheBold };
  }
  const [regBuf, boldBuf] = await Promise.all([
    fetch("/fonts/Pretendard-Regular.ttf").then((r) => r.arrayBuffer()),
    fetch("/fonts/Pretendard-Bold.ttf").then((r) => r.arrayBuffer()),
  ]);
  fontCacheRegular = arrayBufferToBase64(regBuf);
  fontCacheBold = arrayBufferToBase64(boldBuf);
  return { regular: fontCacheRegular, bold: fontCacheBold };
}

function registerFont(doc: jsPDF, fonts: { regular: string; bold: string }) {
  doc.addFileToVFS("Pretendard-Regular.ttf", fonts.regular);
  doc.addFileToVFS("Pretendard-Bold.ttf", fonts.bold);
  doc.addFont("Pretendard-Regular.ttf", "Pretendard", "normal", undefined, "Identity-H");
  doc.addFont("Pretendard-Bold.ttf", "Pretendard", "bold", undefined, "Identity-H");
}

// ─── Colors (B&W + green accent only) ───

const C = {
  primary:   "#36583D",
  black:     "#1C1C1A",
  mid:       "#5A5A52",
  gray:      "#B9B8AF",
  lightGray: "#E0E0DD",
  white:     "#FFFFFF",
};

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ─── White Logo (for dark backgrounds) ───

let whiteLogoCache: string | null = null;

async function getWhiteLogo(): Promise<string> {
  if (whiteLogoCache) return whiteLogoCache;
  const img = new Image();
  img.src = WEDRAW_LOGO_BASE64;
  await new Promise<void>((resolve) => {
    if (img.complete) resolve();
    else img.onload = () => resolve();
  });
  const canvas = document.createElement("canvas");
  canvas.width = WEDRAW_LOGO_W;
  canvas.height = WEDRAW_LOGO_H;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = imageData.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 0) { px[i] = px[i + 1] = px[i + 2] = 255; }
  }
  ctx.putImageData(imageData, 0, 0);
  whiteLogoCache = canvas.toDataURL("image/png");
  return whiteLogoCache;
}

// ─── Order Number ───

function generateOrderNumber(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `ORD-${y}${m}${d}-${rand}`;
}

// ─── Thumbnail Rendering ───

const thumbCache = new Map<string, string>();

/**
 * Render a 3D thumbnail. For tags, pass the assembled preview manifold
 * (upright, matching the app view) and optionally textFill for dark text.
 */
export function renderThumbnail(
  manifold: Manifold,
  cacheKey: string,
  size = 400,
  tagView = false,
  textFillManifold?: Manifold,
): string {
  const fullKey = cacheKey + (tagView ? ":tag" : "");
  const cached = thumbCache.get(fullKey);
  if (cached) return cached;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true, alpha: true, antialias: true });
  renderer.setSize(size, size);
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const geometry = mesh2geometry(manifold);
  geometry.computeVertexNormals();

  // Use a group so we can apply rotation for tag view
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff })));

  const edges = new THREE.EdgesGeometry(geometry, 30);
  group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 1 })));

  // Tag text fill — render as dark mesh
  let tfGeom: THREE.BufferGeometry | null = null;
  if (textFillManifold) {
    tfGeom = mesh2geometry(textFillManifold);
    tfGeom.computeVertexNormals();
    group.add(new THREE.Mesh(tfGeom, new THREE.MeshBasicMaterial({ color: 0x1C1C1A })));
  }

  // Slight Z rotation for assembled tag view (matches app's MESH_ROTATION_DELTA)
  if (tagView) {
    group.rotation.z = 0.1;
  }

  scene.add(group);

  // Compute bounds from the (possibly rotated) group
  const bb = new THREE.Box3().setFromObject(group);
  const center = new THREE.Vector3();
  bb.getCenter(center);
  const sz = new THREE.Vector3();
  bb.getSize(sz);
  const maxDim = Math.max(sz.x, sz.y, sz.z);
  const half = maxDim / 2 + maxDim * (tagView ? 0.2 : 0.12);

  const camera = new THREE.OrthographicCamera(-half, half, half, -half, 0.1, maxDim * 10);
  const d = maxDim * 2;

  if (tagView) {
    // Assembled tag: show front face (+Y) with text/logo visible
    // Camera in front-right-above, looking at center
    camera.position.set(center.x + d * 0.6, center.y + d * 0.6, center.z + d * 0.45);
  } else {
    // Standard isometric
    camera.position.set(center.x + d * 0.7, center.y - d * 0.5, center.z + d * 0.6);
  }
  camera.up.set(0, 0, 1);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
  const dataUrl = canvas.toDataURL("image/png");

  geometry.dispose();
  edges.dispose();
  if (tfGeom) tfGeom.dispose();
  renderer.dispose();

  thumbCache.set(fullKey, dataUrl);
  return dataUrl;
}

// ─── Types ───

export interface OrderLineInfo {
  index: number;
  label: string;
  shape: "box" | "organizer" | "tag";
  snapshot: {
    shape: string;
    width: number; depth: number; height: number;
    radius: number; wall: number; bottom: number;
    cols: number; rows: number;
    tagText: string; tagEmoji: string | null;
  };
  quantity: number;
  thumbnailDataUrl: string;
}

export interface OrderPDFOptions {
  orderName: string;
  lines: OrderLineInfo[];
  date: Date;
}

// ─── Formatters ───

function fmtDate(d: Date) {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function tName(s: string) { return s === "organizer" ? "Grid" : s === "tag" ? "Tag" : "Box"; }

function dimStr(l: OrderLineInfo) {
  const s = l.snapshot;
  if (s.shape === "tag") return "W" + s.width + 'mm  "' + (s.tagEmoji || s.tagText || "blank") + '"';
  return s.width + " x " + s.depth + " x " + s.height + " mm";
}
function specStr(l: OrderLineInfo) {
  const s = l.snapshot;
  if (s.shape === "tag") return "";
  if (s.shape === "organizer") return (s.cols + 1) + " x " + (s.rows + 1) + " cells";
  return "R" + s.radius + "  W" + s.wall + "  B" + s.bottom;
}

// ═══════════════════════════════════════
// LAYOUT CONSTANTS
// ═══════════════════════════════════════

const PW = 210;
const PH = 297;
const HALF = PW / 2;       // 105mm center line
const M = 7;                // margin inside each half
const CW = HALF - M * 2;   // ~91mm content width per half

const HEADER_H = 18;       // green header bar
const FOOTER_H = 10;       // green footer bar
const BODY_TOP_FIRST = HEADER_H + 4;
const BODY_TOP_CONT = 8;
const BODY_BOT = PH - FOOTER_H - 10;

const CARD_H = 32;
const CARD_GAP = 2;
const THUMB_SIZE = 19;

// ═══════════════════════════════════════
// DRAWING HELPERS
// ═══════════════════════════════════════

function truncateText(doc: jsPDF, text: string, maxW: number): string {
  if (doc.getTextWidth(text) <= maxW) return text;
  while (text.length > 1 && doc.getTextWidth(text + "…") > maxW) text = text.slice(0, -1);
  return text + "…";
}

function drawHeader(doc: jsPDF, lx: number, orderNo: string, whiteLogo: string) {
  // Green bar
  doc.setFillColor(...rgb(C.primary));
  doc.rect(lx, 0, HALF, HEADER_H, "F");

  // Brand name — vertically centered with order number as a pair
  doc.setFont("Pretendard", "bold");
  doc.setFontSize(14);
  doc.setTextColor(...rgb(C.white));
  doc.text("PÅLÄGG", lx + M, 10);

  // Order number — below brand
  doc.setFont("Pretendard", "normal");
  doc.setFontSize(6);
  doc.setTextColor(255, 255, 255, 180);
  doc.text(orderNo, lx + M, 14);

  // wedraw logo — right side, vertically centered in header
  const logoH = 7;
  const logoW = logoH * (WEDRAW_LOGO_W / WEDRAW_LOGO_H);
  const logoY = (HEADER_H - logoH) / 2;
  try {
    doc.addImage(whiteLogo, "PNG", lx + HALF - M - logoW, logoY, logoW, logoH);
  } catch { /* skip */ }
}

function drawFooter(doc: jsPDF, lx: number, pageNum: number, totalPages: number) {
  const fy = PH - FOOTER_H;

  doc.setFillColor(...rgb(C.primary));
  doc.rect(lx, fy, HALF, FOOTER_H, "F");

  // Force text color reset after fill
  doc.setTextColor(0, 0, 0);

  doc.setFont("Pretendard", "bold");
  doc.setFontSize(5.5);
  doc.setTextColor(...rgb(C.white));
  doc.text("PÅLÄGG", lx + M, fy + 6.5);

  doc.setFont("Pretendard", "normal");
  doc.setFontSize(6);
  doc.setTextColor(...rgb(C.white));
  doc.text("wedraw.kr", lx + HALF / 2, fy + 6.5, { align: "center" });

  doc.setFontSize(5.5);
  doc.setTextColor(...rgb(C.white));
  doc.text(pageNum + " / " + totalPages, lx + HALF - M, fy + 6.5, { align: "right" });
}

function drawCutLine(doc: jsPDF) {
  doc.setDrawColor(...rgb(C.gray));
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(HALF, 0, HALF, PH);
  doc.setLineDashPattern([], 0);
}

function drawOrderInfo(
  doc: jsPDF, lx: number, y: number,
  titleLine1: string, titleLine2: string,
  orderName: string, date: Date,
  totalItems: number, totalQty: number,
): number {
  const cx = lx + M;
  const right = lx + HALF - M;

  // Title line 1 (bold)
  doc.setFont("Pretendard", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...rgb(C.black));
  doc.text(titleLine1, cx, y);

  // Title line 2 (gray, smaller)
  y += 4;
  doc.setFont("Pretendard", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...rgb(C.gray));
  doc.text(titleLine2, cx, y);

  y += 5;

  // Order name — prominent
  doc.setFont("Pretendard", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...rgb(C.black));
  doc.text(orderName || "-", cx, y);
  // Date — right-aligned, secondary
  doc.setFont("Pretendard", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...rgb(C.mid));
  doc.text(fmtDate(date), right, y, { align: "right" });

  y += 5.5;

  // Total quantity — emphasized
  doc.setFont("Pretendard", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...rgb(C.black));
  doc.text("Total " + totalQty + " pcs", cx, y);
  doc.setFont("Pretendard", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...rgb(C.mid));
  doc.text(totalItems + " items", right, y - 0.5, { align: "right" });

  y += 4;
  doc.setDrawColor(...rgb(C.lightGray));
  doc.setLineWidth(0.3);
  doc.line(cx, y, right, y);

  return y + 3;
}

function drawItemCard(doc: jsPDF, lx: number, y: number, line: OrderLineInfo, withCheckboxes: boolean) {
  const cx = lx + M;
  const right = cx + CW;

  // Card border
  doc.setDrawColor(...rgb(C.lightGray));
  doc.setLineWidth(0.3);
  doc.setFillColor(...rgb(C.white));
  doc.roundedRect(cx, y, CW, CARD_H, 1.5, 1.5, "FD");

  // Force text color reset after fill
  doc.setTextColor(0, 0, 0);

  // Thumbnail
  const tp = 2;
  const thumbX = cx + tp;
  const thumbY = y + (CARD_H - THUMB_SIZE) / 2;
  try {
    doc.addImage(line.thumbnailDataUrl, "PNG", thumbX, thumbY, THUMB_SIZE, THUMB_SIZE);
  } catch { /* skip if thumbnail unavailable */ }

  const tx = thumbX + THUMB_SIZE + 3;

  // Type badge
  const badge = tName(line.shape).toUpperCase();
  doc.setFontSize(4.5);
  doc.setFont("Pretendard", "bold");
  const bw = doc.getTextWidth(badge) + 2.5;
  doc.setDrawColor(...rgb(C.gray));
  doc.setLineWidth(0.2);
  doc.setFillColor(...rgb(C.white));
  doc.roundedRect(tx, y + 2.5, bw, 3.5, 0.8, 0.8, "FD");
  doc.setTextColor(...rgb(C.mid));
  doc.text(badge, tx + 1.2, y + 5);

  // Name — faux bold via double-draw
  doc.setFontSize(8);
  doc.setFont("Pretendard", "bold");
  doc.setTextColor(...rgb(C.black));
  const nameText = "PÅLÄGG " + tName(line.shape);
  doc.text(nameText, tx, y + 12);

  // Dims (truncated to avoid overlap with quantity)
  doc.setFontSize(6.5);
  doc.setFont("Pretendard", "normal");
  doc.setTextColor(...rgb(C.mid));
  doc.text(truncateText(doc, dimStr(line), right - tx - 16), tx, y + 17);

  // Spec
  const sp = specStr(line);
  if (sp) {
    doc.setFontSize(5.5);
    doc.setFont("Pretendard", "normal");
    doc.setTextColor(...rgb(C.gray));
    doc.text(sp, tx, y + 21);
  }

  // Quantity
  doc.setFontSize(13);
  doc.setFont("Pretendard", "bold");
  doc.setTextColor(...rgb(C.black));

  if (withCheckboxes) {
    // Quantity at top-right
    doc.text("x" + line.quantity, right - 3, y + 11, { align: "right" });

    // Per-item checkboxes at bottom-right
    const cbX = right - 26;
    const cbY = y + CARD_H - 7.5;
    doc.setFontSize(5.5);
    doc.setFont("Pretendard", "normal");
    doc.setTextColor(...rgb(C.mid));
    doc.setDrawColor(...rgb(C.gray));
    doc.setLineWidth(0.25);
    doc.rect(cbX, cbY, 2.5, 2.5);
    doc.text("QC", cbX + 3.5, cbY + 2);
    doc.rect(cbX + 13, cbY, 2.5, 2.5);
    doc.text("Ship", cbX + 16.5, cbY + 2);
  } else {
    // Quantity centered vertically
    doc.text("x" + line.quantity, right - 3, y + CARD_H / 2 + 3, { align: "right" });
  }
}

function drawTotal(doc: jsPDF, lx: number, y: number, totalQty: number): number {
  const cx = lx + M;
  const right = cx + CW;

  doc.setDrawColor(...rgb(C.lightGray));
  doc.setLineWidth(0.3);
  doc.line(cx, y, right, y);
  y += 5;

  doc.setFont("Pretendard", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...rgb(C.black));
  const totalText = "Total: " + totalQty + " pcs";
  doc.text(totalText, right, y, { align: "right" });

  return y + 3;
}

/** Customer side: QC sign-off at the end */
function drawCustomerSignature(doc: jsPDF, lx: number, y: number): number {
  const cx = lx + M;
  const right = cx + CW;
  const labelW = 18;

  y += 4;
  doc.setDrawColor(...rgb(C.lightGray));
  doc.setLineWidth(0.3);
  doc.line(cx, y, right, y);
  y += 6;

  doc.setFont("Pretendard", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...rgb(C.black));
  doc.text("QC Sign-off", cx, y);
  y += 7;

  doc.setFont("Pretendard", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...rgb(C.mid));

  // Inspector
  doc.text("Inspector", cx, y);
  doc.setDrawColor(...rgb(C.lightGray));
  doc.setLineWidth(0.2);
  doc.line(cx + labelW, y, right, y);
  y += 7;

  // Date
  doc.text("Date", cx, y);
  doc.line(cx + labelW, y, right, y);
  y += 7;

  // Signature box
  doc.text("Signature", cx, y);
  doc.setDrawColor(...rgb(C.lightGray));
  doc.setLineWidth(0.3);
  doc.rect(cx + labelW, y - 5, right - cx - labelW, 12);

  return y + 10;
}

/** Internal side: notes area at the end */
function drawInternalNote(doc: jsPDF, lx: number, y: number): number {
  const cx = lx + M;
  const right = cx + CW;

  y += 4;
  doc.setDrawColor(...rgb(C.lightGray));
  doc.setLineWidth(0.3);
  doc.line(cx, y, right, y);
  y += 6;

  // Notes box
  doc.setFont("Pretendard", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...rgb(C.mid));
  doc.text("Notes", cx, y);
  y += 2;
  doc.setDrawColor(...rgb(C.lightGray));
  doc.rect(cx, y, CW, 14);
  y += 17;

  // Staff + Date
  doc.text("Staff", cx, y);
  doc.setDrawColor(...rgb(C.lightGray));
  doc.setLineWidth(0.2);
  doc.line(cx + 12, y, right, y);
  y += 6;
  doc.text("Date", cx, y);
  doc.line(cx + 12, y, right, y);

  return y + 3;
}

// ═══════════════════════════════════════
// PDF GENERATION
// ═══════════════════════════════════════

export async function generateOrderPDF(opts: OrderPDFOptions): Promise<Blob> {
  const { orderName, lines, date } = opts;
  const [fonts, whiteLogo] = await Promise.all([loadFonts(), getWhiteLogo()]);
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  registerFont(doc, fonts);


  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const orderNo = generateOrderNumber(date);

  // ── Pagination ──
  const SIGNATURE_H = 55;
  const pages: { startIdx: number; endIdx: number; isLast: boolean }[] = [];
  let idx = 0;
  let pageIdx = 0;

  while (idx < lines.length) {
    pageIdx++;
    const bodyTop = pageIdx === 1 ? BODY_TOP_FIRST + 21 : BODY_TOP_CONT + 4;
    const availH = BODY_BOT - bodyTop;
    const maxCards = Math.floor(availH / (CARD_H + CARD_GAP));
    const remaining = lines.length - idx;

    if (remaining <= maxCards) {
      // Last batch — check if signature fits
      const cardsH = remaining * (CARD_H + CARD_GAP);
      if (cardsH + SIGNATURE_H > availH && remaining > 1) {
        const reducedCount = Math.max(1, Math.floor((availH - SIGNATURE_H) / (CARD_H + CARD_GAP)));
        pages.push({ startIdx: idx, endIdx: idx + reducedCount, isLast: false });
        idx += reducedCount;
        continue;
      }
      pages.push({ startIdx: idx, endIdx: idx + remaining, isLast: true });
      idx += remaining;
    } else {
      const count = Math.min(maxCards, remaining);
      pages.push({ startIdx: idx, endIdx: idx + count, isLast: false });
      idx += count;
    }
  }

  if (pages.length === 0) {
    pages.push({ startIdx: 0, endIdx: 0, isLast: true });
  }

  const totalPages = pages.length;

  // ── Render pages ──
  // Draw each column fully before the other to avoid jsPDF font-encoding
  // state corruption when CJK characters are interleaved with Latin text.
  for (let pi = 0; pi < pages.length; pi++) {
    if (pi > 0) doc.addPage();
    const page = pages[pi];

    // ── Left column (Customer Copy) ──
    drawHeader(doc, 0, orderNo, whiteLogo);

    let yL: number;
    if (pi === 0) {
      yL = drawOrderInfo(doc, 0, BODY_TOP_FIRST, "Order Confirmation", "Customer Copy", orderName, date, lines.length, totalQty);
    } else {
      yL = BODY_TOP_CONT + 4;
      doc.setFont("Pretendard", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...rgb(C.gray));
      doc.text("(cont.)", M, yL - 1);
    }

    for (let i = page.startIdx; i < page.endIdx; i++) {
      drawItemCard(doc, 0, yL, lines[i], false);
      yL += CARD_H + CARD_GAP;
    }

    if (page.isLast) {
      yL += 2;
      yL = drawTotal(doc, 0, yL, totalQty);
      drawCustomerSignature(doc, 0, yL);
    }

    drawFooter(doc, 0, pi + 1, totalPages);

    // ── Right column (Internal Copy) ──
    drawHeader(doc, HALF, orderNo, whiteLogo);

    let yR: number;
    if (pi === 0) {
      yR = drawOrderInfo(doc, HALF, BODY_TOP_FIRST, "Shipment Record", "Internal Copy", orderName, date, lines.length, totalQty);
    } else {
      yR = BODY_TOP_CONT + 4;
      doc.setFont("Pretendard", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...rgb(C.gray));
      doc.text("(cont.)", HALF + M, yR - 1);
    }

    for (let i = page.startIdx; i < page.endIdx; i++) {
      drawItemCard(doc, HALF, yR, lines[i], true);
      yR += CARD_H + CARD_GAP;
    }

    if (page.isLast) {
      yR += 2;
      yR = drawTotal(doc, HALF, yR, totalQty);
      drawInternalNote(doc, HALF, yR);
    }

    drawFooter(doc, HALF, pi + 1, totalPages);

    // Cut line (drawn last so it overlays both columns)
    drawCutLine(doc);
  }

  return doc.output("blob") as unknown as Blob;
}
