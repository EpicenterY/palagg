import "./style.css";

import * as THREE from "three";
import { Renderer } from "./rendering/renderer";

import { CLIP_HEIGHT, box, drawerOrganizer } from "./model/manifold";
import { exportMultiBodyManifold, exportBuildPlate3MF, mesh2geometry, computeCreaseNormals } from "./model/export";
import type { BuildPlateGroup } from "./model/export";
import { generateOrderPDF, renderThumbnail } from "./order-pdf";
import type { OrderLineInfo } from "./order-pdf";
import { TMFLoader } from "./model/load";
import { Animate, immediate } from "./animate";
import { tagPreview, tagExportBodies, TAG_DEFAULT_WIDTH, TAG_MIN_WIDTH, TAG_MAX_WIDTH, TAG_MAX_TEXT_CONTENT_WIDTH, TAG_TEXT_AREA_HEIGHT } from "./model/tag";
import { measureTextWidth } from "./model/text";
import { EMOJI_PRESETS } from "./model/emoji";

import { Dyn } from "twrl";

import { rangeControl, stepper, toggleControl, textInput, emojiPicker, addEmojiButton } from "./controls";
import { searchIcons, fetchIconData, iconifyToPreset } from "./iconify";
import { loadCustomIcons, saveCustomIcon } from "./icon-store";
import { remainingQuota, recordDownload, msUntilNextSlot, resetQuota, DOWNLOAD_LIMIT } from "./rate-limit";
import confetti from "canvas-confetti";

/// CONSTANTS

// Align axes with 3D printer
THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

const DIMENSIONS = [
  "height",
  "width",
  "depth",
  "radius",
  "wall",
  "bottom",
] as const;

type ShapeType = "box" | "organizer" | "tag";

// constants, all in outer dimensions (when applicable)

// actual constants
const START_RADIUS = 6;
const START_WALL = 2;
const START_BOTTOM = 3;

const START_COLS = 2;
const START_ROWS = 2;
const MAX_COLS = 8;
const MAX_ROWS = 8;

const START_HEIGHT = 52; /* calculated manually from START_LEVELS */
const START_LEVELS = 2;
const MIN_LEVELS = 1;
const MAX_LEVELS = 5;

const START_TOP_EXTRA = 0;
const MIN_TOP_EXTRA = 0;
const MAX_TOP_EXTRA = 20; // 1/2 of next hook interval (40mm)

const START_WIDTH = 80;
const MIN_WIDTH = 10 + 2 * START_RADIUS;
const MAX_WIDTH = 204; /* somewhat arbitrary */

const START_DEPTH = 60;
const MIN_DEPTH = 20;
const MAX_DEPTH = 204; /* somewhat arbitrary */

/// STATE

// Dimensions of the model (outer, where applicable).
// These are the dimensions of the 3MF file, as well as
// the _target_ dimensions for the animations, though may
// be (ephemerally) different from the animation values.

const shapeType = new Dyn<ShapeType>("box");

const levels = new Dyn(START_LEVELS); /* number of clip levels */
const topExtra = new Dyn(START_TOP_EXTRA); /* extra body height above top hook */

const cols = new Dyn(START_COLS);
const rows = new Dyn(START_ROWS);

// Tag state
const tagText = new Dyn<string>("");
const tagEmoji = new Dyn<string | null>(null);
const tagWidth = new Dyn(TAG_DEFAULT_WIDTH);
let tagTextDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let tagFirstVisit = true;

const baseHeight = levels.map(
  (x) => x * CLIP_HEIGHT + (x - 1) * (40 - CLIP_HEIGHT),
);

const modelDimensions = {
  height: Dyn.sequence([baseHeight, topExtra] as const).map(
    ([h, extra]) => h + extra,
  ),
  width: new Dyn(START_WIDTH),
  depth: new Dyn(START_DEPTH),
  radius: new Dyn(START_RADIUS),
  wall: new Dyn(START_WALL),
  bottom: new Dyn(START_BOTTOM),
};

const innerWidth = Dyn.sequence([
  modelDimensions.wall,
  modelDimensions.width,
] as const).map(([wall, width]) => width - 2 * wall);

const innerDepth = Dyn.sequence([
  modelDimensions.wall,
  modelDimensions.depth,
] as const).map(([wall, depth]) => depth - 2 * wall);

// Current state of part positioning
type PartPositionStatic = Extract<PartPosition, { tag: "static" }>;
type PartPosition =
  | {
      tag: "static";
      position: -1 | 0 | 1;
    } /* no current mouse interaction. -1 and +1 are different as they represent different ways of showing the back of the part (CW or CCW) */
  | {
      tag: "will-move";
      startRot: number;
      startPos: [number, number];
      clock: THREE.Clock;
      lastStatic: Extract<PartPosition, { tag: "static" }>;
    } /* mouse was down but hasn't moved yet */
  | {
      tag: "moving";
      startRot: number;
      startPos: [number, number];
      lastStatic: Extract<PartPosition, { tag: "static" }>;
      clock: THREE.Clock;
      x: number;
    } /* mouse is moving */;
const partPositioning = new Dyn<PartPosition>({ tag: "static", position: 0 });

/// MODEL

const tmfLoader = new TMFLoader();

interface ModelSnapshot {
  shape: ShapeType;
  height: number;
  topExtra: number;
  width: number;
  depth: number;
  radius: number;
  wall: number;
  bottom: number;
  cols: number;
  rows: number;
  tagText: string;
  tagEmoji: string | null;
}

interface OrderLine {
  key: string;
  snapshot: ModelSnapshot;
  filename: string;
  quantity: number;
}

const snapshotKey = (snapshot: ModelSnapshot) =>
  [
    snapshot.shape,
    snapshot.height,
    snapshot.topExtra,
    snapshot.width,
    snapshot.depth,
    snapshot.radius,
    snapshot.wall,
    snapshot.bottom,
    snapshot.cols,
    snapshot.rows,
    snapshot.tagText,
    snapshot.tagEmoji ?? "",
  ].join("|");

const buildSnapshot = (): ModelSnapshot => ({
  shape: shapeType.latest,
  height: modelDimensions.height.latest,
  topExtra: topExtra.latest,
  width: shapeType.latest === "tag" ? tagWidth.latest : modelDimensions.width.latest,
  depth: modelDimensions.depth.latest,
  radius: modelDimensions.radius.latest,
  wall: modelDimensions.wall.latest,
  bottom: modelDimensions.bottom.latest,
  cols: cols.latest,
  rows: rows.latest,
  tagText: tagText.latest,
  tagEmoji: tagEmoji.latest,
});

const modelForSnapshot = async (snapshot: ModelSnapshot) => {
  if (snapshot.shape === "tag") {
    const { preview } = await tagPreview(snapshot.width, snapshot.tagText, snapshot.tagEmoji);
    return preview;
  }
  return snapshot.shape === "organizer"
    ? drawerOrganizer(
        snapshot.height,
        snapshot.width,
        snapshot.depth,
        snapshot.radius,
        snapshot.wall,
        snapshot.bottom,
        snapshot.cols,
        snapshot.rows,
        snapshot.height - snapshot.topExtra,
      )
    : box(
        snapshot.height,
        snapshot.height - snapshot.topExtra,
        snapshot.width,
        snapshot.depth,
        snapshot.radius,
        snapshot.wall,
        snapshot.bottom,
      );
};

const filenameForSnapshot = (snapshot: ModelSnapshot) => {
  if (snapshot.shape === "tag") {
    const content = snapshot.tagEmoji
      ? snapshot.tagEmoji
      : snapshot.tagText.trim() || "blank";
    const safeName = content.replace(/[^a-zA-Z0-9_-]/g, "");
    return `palagg-tag-${snapshot.width}-${safeName || "text"}`;
  }
  return snapshot.shape === "organizer"
    ? `palagg-grid-${snapshot.width}-${snapshot.depth}-${snapshot.height}.3mf`
    : `palagg-${snapshot.width}-${snapshot.depth}-${snapshot.height}.3mf`;
};

const labelForSnapshot = (snapshot: ModelSnapshot) => {
  if (snapshot.shape === "tag") {
    const content = snapshot.tagEmoji
      ? EMOJI_PRESETS.find((p) => p.id === snapshot.tagEmoji)?.label ?? snapshot.tagEmoji
      : `"${snapshot.tagText}"`;
    return `PÅLÄGG Tag ${snapshot.width} ${content}`;
  }
  return snapshot.shape === "organizer"
    ? `PÅLÄGG Grid ${snapshot.width}×${snapshot.depth}×${snapshot.height} (${snapshot.cols + 1}X${snapshot.rows + 1})`
    : `PÅLÄGG Box ${snapshot.width}×${snapshot.depth}×${snapshot.height}`;
};

// Reloads the model seen on page
async function reloadModel(
  height: number,
  hookReferenceHeight: number,
  width: number,
  depth: number,
  radius: number,
  wall: number,
  bottom: number,
  shape: ShapeType,
  c: number,
  ro: number,
) {
  let model;
  let tagTextFill: import("manifold-3d").Manifold | null = null;

  if (shape === "tag") {
    // Capture the width before await — animation.current changes during async build
    const usedWidth = tagWidthAnimation.current;
    const result = await tagPreview(usedWidth, tagText.latest, tagEmoji.latest);
    model = result.preview;
    tagTextFill = result.textFill;
    // Sync width slider only when text genuinely forces the plate wider.
    // tagTextPlate applies Math.ceil, so small (<1mm) differences are just rounding.
    // Only sync when the model had to widen beyond what was requested.
    if (result.actualWidth > usedWidth + 1) {
      tagWidth.send(Math.round(result.actualWidth));
    }
  } else if (shape === "organizer") {
    model = await drawerOrganizer(
      height,
      width,
      depth,
      radius,
      wall,
      bottom,
      c,
      ro,
      hookReferenceHeight,
    );
  } else {
    model = await box(
      height,
      hookReferenceHeight,
      width,
      depth,
      radius,
      wall,
      bottom,
    );
  }
  const geometry = mesh2geometry(model);
  if (shape === "tag") {
    // Tag has curved stadium surfaces — use crease normals for smooth shading
    computeCreaseNormals(geometry, Math.PI / 6);
  } else {
    // Box/Grid — fast built-in normals (matches original skapa performance)
    geometry.computeVertexNormals();
  }
  mesh.geometry = geometry;
  mesh.clear();

  // Add text fill as a separate child mesh on layer 1 (rendered as black by fill pass)
  if (tagTextFill) {
    const textGeom = mesh2geometry(tagTextFill);
    computeCreaseNormals(textGeom, Math.PI / 6);
    const textMesh = new THREE.Mesh(textGeom);
    textMesh.layers.enable(1);
    mesh.add(textMesh);
  }
}

// when target dimensions are changed, update the model to download
// Debounce the download-model build so it doesn't run CSG on every slider tick.
// The 3D preview rebuild (in the render loop) is separate and throttled independently.
let tmfDebounceTimer: ReturnType<typeof setTimeout> | undefined;
const TMF_DEBOUNCE_MS = 300;

Dyn.sequence([
  shapeType,
  modelDimensions.height,
  modelDimensions.width,
  modelDimensions.depth,
  modelDimensions.radius,
  modelDimensions.wall,
  modelDimensions.bottom,
  topExtra,
  cols,
  rows,
  tagText,
  tagEmoji,
  tagWidth,
] as const).addListener(([shape, h, w, d, r, wa, bo, extra, c, ro, tt, te, tw]) => {
  const snapshot: ModelSnapshot = {
    shape,
    height: h,
    topExtra: extra,
    width: shape === "tag" ? tw : w,
    depth: d,
    radius: r,
    wall: wa,
    bottom: bo,
    cols: c,
    rows: ro,
    tagText: tt,
    tagEmoji: te,
  };
  if (shape === "tag") {
    // For tags, we don't use tmfLoader since download is a ZIP
    // Just trigger reloadModelNeeded
    reloadModelNeeded = true;
  } else {
    // Debounce: only build the download model after input settles,
    // so slider drag doesn't trigger costly CSG for the download link.
    clearTimeout(tmfDebounceTimer);
    tmfDebounceTimer = setTimeout(() => {
      const filename = filenameForSnapshot(snapshot);
      const modelP = modelForSnapshot(snapshot);
      tmfLoader.load(modelP, filename);
    }, TMF_DEBOUNCE_MS);
  }
});

/// RENDER

// Set to 'true' whenever the camera needs to be centered again
let centerCameraNeeded = true;

// The mesh, updated in place when the geometry needs to change
const mesh: THREE.Mesh = new THREE.Mesh(
  new THREE.BoxGeometry(
    modelDimensions.width.latest,
    modelDimensions.height.latest,
    modelDimensions.depth.latest,
  ),
  new THREE.Material(),
);

// Center the camera around the mesh
async function centerCamera() {
  // Create a "world" matrix which only includes the part rotation (we don't use the actual
  // world matrix to avoid rotation animation messing with the centering)
  const mat = new THREE.Matrix4();
  mat.makeRotationAxis(new THREE.Vector3(0, 0, 1), MESH_ROTATION_DELTA);
  const padding = shapeType.latest === "tag" ? 0.2 : 0;
  renderer.centerCameraAround(mesh, mat, padding);
}

const MESH_ROTATION_DELTA = 0.1;
mesh.rotation.z = MESH_ROTATION_DELTA;

const canvas = document.querySelector("canvas") as HTMLCanvasElement;
const renderer = new Renderer(canvas, mesh);

let reloadModelNeeded = true;

// The animated rotation, between -1 and 1
const rotation = new Animate(0);

/* Bound the number betweek lo & hi (modulo) */
const bound = (v: number, [lo, hi]: [number, number]): number =>
  ((v - lo) % (hi - lo)) + lo;

partPositioning.addListener((val) => {
  if (val.tag === "static") {
    rotation.startAnimationTo(val.position);
  } else if (val.tag === "moving") {
    /* the delta of width (between -1 and 1, so 2) per delta of (horizontal, CSS) pixel */
    const dwdx = 2 / renderer.canvasWidth;
    const v = (val.x - val.startPos[0]) * dwdx - val.startRot;
    rotation.startAnimationTo(bound(v, [-1, 1]), immediate);
  } else {
    val.tag satisfies "will-move";
    /* not movement yet, so not need to move */
  }
});

/// ANIMATIONS

// The animated dimensions
const animations = {
  height: new Animate(START_HEIGHT),
  width: new Animate(START_WIDTH),
  depth: new Animate(START_DEPTH),
  radius: new Animate(START_RADIUS),
  wall: new Animate(START_WALL),
  bottom: new Animate(START_BOTTOM),
};

const hookReferenceAnimation = new Animate(baseHeight.latest);

const tagWidthAnimation = new Animate(TAG_DEFAULT_WIDTH);

DIMENSIONS.forEach((dim) =>
  modelDimensions[dim].addListener((val) => {
    animations[dim].startAnimationTo(val);
  }),
);

baseHeight.addListener((val) => {
  hookReferenceAnimation.startAnimationTo(val);
});

const ORGANIZER_DIMS = ["cols", "rows"] as const;
const organizerAnimations = {
  cols: new Animate(START_COLS),
  rows: new Animate(START_ROWS),
};

cols.addListener((v) => organizerAnimations.cols.startAnimationTo(v));
rows.addListener((v) => organizerAnimations.rows.startAnimationTo(v));

tagWidth.addListener((v) => tagWidthAnimation.startAnimationTo(v));

/// DOM

// Download button
const link = document.querySelector("#download") as HTMLAnchorElement;

const addToOrderButton = document.querySelector(
  "#add-to-order",
) as HTMLButtonElement;
const placeOrderButton = document.querySelector(
  "#place-order",
) as HTMLButtonElement;
const orderItemsList = document.querySelector("#order-items") as HTMLUListElement;
const orderSummary = document.querySelector(".order-sheet-title") as HTMLHeadingElement;
const orderLines: OrderLine[] = [];
let orderZipUrl: string | undefined;
let tagDownloadUrl: string | undefined;

// ── Quota UI (inside #download button) ──
const quotaContainer = document.createElement("span");
quotaContainer.className = "download-quota";

const quotaDots = document.createElement("span");
quotaDots.className = "download-quota-dots";
for (let i = 0; i < DOWNLOAD_LIMIT; i++) {
  const dot = document.createElement("span");
  dot.className = "download-quota-dot";
  quotaDots.appendChild(dot);
}

const quotaText = document.createElement("span");
quotaText.className = "download-quota-text";

quotaContainer.appendChild(quotaDots);
quotaContainer.appendChild(quotaText);

link.textContent = "";
const linkLabel = document.createElement("span");
linkLabel.textContent = "3MF 다운로드";
link.appendChild(linkLabel);
link.appendChild(quotaContainer);

let quotaTimerId: ReturnType<typeof setInterval> | undefined;

const updatePlaceOrderDisabled = () => {
  placeOrderButton.disabled = orderLines.length === 0;
};

const refreshQuotaUI = () => {
  const remaining = remainingQuota();
  const dots = quotaDots.children;
  for (let i = 0; i < DOWNLOAD_LIMIT; i++) {
    dots[i].classList.toggle("is-filled", i < remaining);
  }

  if (remaining > 0) {
    quotaText.textContent = `${remaining}/${DOWNLOAD_LIMIT}`;
    link.classList.remove("is-exhausted");
    if (quotaTimerId !== undefined) {
      clearInterval(quotaTimerId);
      quotaTimerId = undefined;
    }
  } else {
    const formatCountdown = (ms: number) => {
      const totalSec = Math.ceil(ms / 1000);
      const min = Math.floor(totalSec / 60);
      const sec = totalSec % 60;
      return `${min}:${String(sec).padStart(2, "0")}`;
    };
    quotaText.textContent = formatCountdown(msUntilNextSlot());
    link.classList.add("is-exhausted");

    if (quotaTimerId === undefined) {
      quotaTimerId = setInterval(() => {
        if (remainingQuota() > 0) {
          refreshQuotaUI();
          updatePlaceOrderDisabled();
        } else {
          quotaText.textContent = formatCountdown(msUntilNextSlot());
        }
      }, 1000);
    }
  }

  updatePlaceOrderDisabled();
};

refreshQuotaUI();

// ── Secret quota reset (3 clicks on dots → password prompt) ──
let secretClickCount = 0;
let secretClickTimer: ReturnType<typeof setTimeout> | undefined;

quotaDots.addEventListener("click", (e) => {
  e.stopPropagation();
  e.preventDefault();
  secretClickCount++;
  if (secretClickTimer !== undefined) clearTimeout(secretClickTimer);
  if (secretClickCount >= 3) {
    secretClickCount = 0;
    const pin = prompt("비밀번호를 입력해 주세요. (힌트 : 이비오 창립기념일)");
    if (pin === "0715") {
      resetQuota();
      refreshQuotaUI();
      // 🎉 Fireworks celebration
      const end = Date.now() + 1500;
      const frame = () => {
        confetti({ particleCount: 3, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
        confetti({ particleCount: 3, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
        if (Date.now() < end) requestAnimationFrame(frame);
      };
      frame();
    }
  } else {
    secretClickTimer = setTimeout(() => {
      secretClickCount = 0;
    }, 1500);
  }
});

// Update download button text for tag mode
shapeType.addListener((_shape) => {
  linkLabel.textContent = "3MF 다운로드";
});

// Handle tag download via click
link.addEventListener("click", async (e) => {
  if (shapeType.latest !== "tag") {
    // Non-tag: rate limit gate for <a> default behavior
    if (remainingQuota() <= 0) {
      e.preventDefault();
      return;
    }
    if (!recordDownload()) {
      e.preventDefault();
      refreshQuotaUI();
      return;
    }
    refreshQuotaUI();
    return; // Let default <a> behavior proceed
  }

  // Tag mode
  e.preventDefault();

  if (remainingQuota() <= 0) return;
  if (!recordDownload()) {
    refreshQuotaUI();
    return;
  }
  refreshQuotaUI();

  const snapshot = buildSnapshot();
  const baseName = filenameForSnapshot(snapshot);
  const { bodies } = await tagExportBodies(snapshot.width, snapshot.tagText, snapshot.tagEmoji);
  const blob = exportMultiBodyManifold(bodies);

  if (tagDownloadUrl) URL.revokeObjectURL(tagDownloadUrl);
  tagDownloadUrl = URL.createObjectURL(blob);

  const tempLink = document.createElement("a");
  tempLink.href = tagDownloadUrl;
  tempLink.download = `${baseName}.3mf`;
  tempLink.click();
});

const renderOrderSheet = () => {
  const totalQuantity = orderLines.reduce((sum, line) => sum + line.quantity, 0);
  orderSummary.textContent = `총 ${totalQuantity}개의 PÅLÄGG`;

  if (orderLines.length === 0) {
    orderItemsList.innerHTML =
      '<li class="order-items-empty">아직 추가된 주문이 없습니다.</li>';
    updatePlaceOrderDisabled();
    return;
  }

  orderItemsList.innerHTML = orderLines
    .map(
      (line, index) => `
      <li class="order-item">
        <span class="order-item-index">${index + 1}</span>
        <span class="order-item-label">${labelForSnapshot(line.snapshot)}</span>
        <span class="order-item-qty">x${line.quantity}</span>
        <button type="button" class="order-item-remove" data-order-key="${line.key}" aria-label="주문 항목 삭제">×</button>
      </li>
    `,
    )
    .join("");

  updatePlaceOrderDisabled();
};

const addCurrentSelectionToOrder = () => {
  const snapshot = buildSnapshot();
  const key = snapshotKey(snapshot);
  const existing = orderLines.find((line) => line.key === key);
  if (existing) {
    existing.quantity += 1;
  } else {
    orderLines.push({
      key,
      snapshot,
      filename: filenameForSnapshot(snapshot),
      quantity: 1,
    });
  }
  renderOrderSheet();
};

function promptOrderName(): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog";

    const title = document.createElement("h3");
    title.className = "modal-title";
    title.textContent = "주문자 이름";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "modal-input";
    input.placeholder = "이름을 입력하세요";
    input.maxLength = 30;

    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "modal-btn modal-btn-cancel";
    cancelBtn.textContent = "취소";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "modal-btn modal-btn-confirm";
    confirmBtn.textContent = "다운로드";

    buttons.append(cancelBtn, confirmBtn);
    dialog.append(title, input, buttons);
    overlay.append(dialog);
    document.body.append(overlay);

    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    input.focus();

    const cleanup = (result: string | null) => {
      overlay.classList.remove("is-visible");
      overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
      resolve(result);
    };

    confirmBtn.addEventListener("click", () => {
      input.blur(); // Force IME composition commit before reading value
      cleanup(input.value.trim());
    });
    cancelBtn.addEventListener("click", () => cleanup(null));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(null); });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) cleanup(input.value.trim());
      if (e.key === "Escape") cleanup(null);
    });
  });
}

function openIconSearchModal(): Promise<import("./model/emoji").EmojiPreset | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";

    const dialog = document.createElement("div");
    dialog.className = "modal-dialog icon-search-dialog";

    const title = document.createElement("h3");
    title.className = "modal-title";
    title.textContent = "Search Icons";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "modal-input";
    input.placeholder = "Search Material Symbols...";

    const status = document.createElement("div");
    status.className = "icon-search-status";
    status.textContent = "";

    const grid = document.createElement("div");
    grid.className = "icon-search-grid";

    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "modal-btn modal-btn-cancel";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "modal-btn modal-btn-confirm";
    confirmBtn.textContent = "Select";
    confirmBtn.disabled = true;

    buttons.append(cancelBtn, confirmBtn);
    dialog.append(title, input, status, grid, buttons);
    overlay.append(dialog);
    document.body.append(overlay);

    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    input.focus();

    let selected: import("./model/emoji").EmojiPreset | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (result: typeof selected) => {
      overlay.classList.remove("is-visible");
      overlay.addEventListener("transitionend", () => overlay.remove(), { once: true });
      resolve(result);
    };

    // Render search results
    const renderResults = (
      presets: { preset: import("./model/emoji").EmojiPreset; body: string }[],
    ) => {
      grid.innerHTML = "";
      for (const { preset, body } of presets) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "icon-search-item";
        btn.title = preset.label;
        btn.setAttribute("aria-label", preset.label);

        // Render using the raw SVG body for visual accuracy
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        const vb = preset.viewBox;
        svg.setAttribute("viewBox", `${vb[0]} ${vb[1]} ${vb[2]} ${vb[3]}`);
        svg.setAttribute("fill", "currentColor");
        svg.innerHTML = body;
        btn.appendChild(svg);

        btn.addEventListener("click", () => {
          grid.querySelectorAll(".selected").forEach((el) => el.classList.remove("selected"));
          btn.classList.add("selected");
          selected = preset;
          confirmBtn.disabled = false;
        });

        grid.appendChild(btn);
      }
    };

    // Search handler with debounce
    input.addEventListener("input", () => {
      clearTimeout(debounceTimer);
      const query = input.value.trim();
      if (!query) {
        status.textContent = "";
        grid.innerHTML = "";
        selected = null;
        confirmBtn.disabled = true;
        return;
      }
      status.textContent = "Searching...";
      debounceTimer = setTimeout(async () => {
        try {
          const result = await searchIcons(query);
          if (result.icons.length === 0) {
            status.textContent = "No results found.";
            grid.innerHTML = "";
            selected = null;
            confirmBtn.disabled = true;
            return;
          }
          // Extract prefix and icon names
          const iconsByPrefix = new Map<string, string[]>();
          for (const icon of result.icons) {
            const [prefix, name] = icon.split(":");
            if (!iconsByPrefix.has(prefix)) iconsByPrefix.set(prefix, []);
            iconsByPrefix.get(prefix)!.push(name);
          }

          const presets: { preset: import("./model/emoji").EmojiPreset; body: string }[] = [];
          for (const [prefix, names] of iconsByPrefix) {
            const data = await fetchIconData(prefix, names);
            const defaultW = data.width ?? 24;
            const defaultH = data.height ?? 24;
            for (const name of names) {
              const iconData = data.icons[name];
              if (!iconData) continue;
              const fullName = `${prefix}:${name}`;
              const label = name.replace(/-/g, " ");
              const preset = iconifyToPreset(
                fullName,
                label,
                iconData.body,
                defaultW,
                defaultH,
                iconData.width,
                iconData.height,
              );
              presets.push({ preset, body: iconData.body });
            }
          }

          status.textContent = `${presets.length} icons found`;
          selected = null;
          confirmBtn.disabled = true;
          renderResults(presets);
        } catch {
          status.textContent = "Search failed. Please try again.";
        }
      }, 400);
    });

    confirmBtn.addEventListener("click", () => cleanup(selected));
    cancelBtn.addEventListener("click", () => cleanup(null));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) cleanup(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") cleanup(null);
    });
  });
}

const downloadOrderAs3MF = async () => {
  if (orderLines.length === 0) return;

  const orderName = await promptOrderName();
  if (orderName === null) return;

  placeOrderButton.disabled = true;
  placeOrderButton.textContent = "주문 파일 생성 중...";

  try {
    const groups: BuildPlateGroup[] = [];
    // Build models for each line; also generate thumbnails for PDF
    const pdfLines: OrderLineInfo[] = [];

    for (let i = 0; i < orderLines.length; i++) {
      const line = orderLines[i];
      if (line.snapshot.shape === "tag") {
        const { bodies } = await tagExportBodies(
          line.snapshot.width,
          line.snapshot.tagText,
          line.snapshot.tagEmoji,
        );
        groups.push({ bodies, quantity: line.quantity, name: line.filename });

        // Thumbnail: use assembled preview (upright, matching app view)
        const { preview: thumbPreview, textFill: thumbTextFill } = await tagPreview(
          line.snapshot.width,
          line.snapshot.tagText,
          line.snapshot.tagEmoji,
        );
        const thumb = renderThumbnail(thumbPreview, line.key, 400, true, thumbTextFill ?? undefined);
        pdfLines.push({
          index: i,
          label: labelForSnapshot(line.snapshot),
          shape: "tag",
          snapshot: line.snapshot,
          quantity: line.quantity,
          thumbnailDataUrl: thumb,
        });
      } else {
        const model = await modelForSnapshot(line.snapshot);
        groups.push({
          bodies: [{ manifold: model, name: line.filename }],
          quantity: line.quantity,
          name: line.filename,
        });

        const thumb = renderThumbnail(model, line.key);
        pdfLines.push({
          index: i,
          label: labelForSnapshot(line.snapshot),
          shape: line.snapshot.shape as "box" | "organizer",
          snapshot: line.snapshot,
          quantity: line.quantity,
          thumbnailDataUrl: thumb,
        });
      }
    }

    const blob = exportBuildPlate3MF(groups);

    if (orderZipUrl) {
      URL.revokeObjectURL(orderZipUrl);
    }

    orderZipUrl = URL.createObjectURL(blob);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const safeName = orderName.replace(/[^a-zA-Z0-9가-힣_-]/g, "");
    const namePart = safeName ? `-${safeName}` : "";
    const tempLink = document.createElement("a");
    tempLink.href = orderZipUrl;
    tempLink.download = `palagg-order${namePart}-${stamp}.3mf`;
    tempLink.click();

    // Generate and download PDF order summary
    const pdfBlob = await generateOrderPDF({
      orderName: orderName || "",
      lines: pdfLines,
      date: now,
    });

    const pdfUrl = URL.createObjectURL(pdfBlob);
    const pdfLink = document.createElement("a");
    pdfLink.href = pdfUrl;
    pdfLink.download = `palagg-order${namePart}-${stamp}.pdf`;
    setTimeout(() => {
      pdfLink.click();
      URL.revokeObjectURL(pdfUrl);
    }, 100);

    orderLines.length = 0;
    renderOrderSheet();
  } finally {
    placeOrderButton.textContent = "한번에 주문하기";
    updatePlaceOrderDisabled();
  }
};

addToOrderButton.addEventListener("click", addCurrentSelectionToOrder);
placeOrderButton.addEventListener("click", async () => {
  try {
    await downloadOrderAs3MF();
  } catch {
    placeOrderButton.textContent = "다운로드 실패, 다시 시도";
  }
});

orderItemsList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  if (!target.classList.contains("order-item-remove")) return;

  const key = target.dataset.orderKey;
  if (!key) return;

  const index = orderLines.findIndex((line) => line.key === key);
  if (index < 0) return;

  orderLines.splice(index, 1);
  renderOrderSheet();
});

renderOrderSheet();

const controls = document.querySelector("#controls") as HTMLDivElement;

// Shape selector (prepended so it appears first)
const shapeControl = toggleControl("shape", {
  options: [
    { value: "box", label: "Box" },
    { value: "organizer", label: "Grid" },
    { value: "tag", label: "Tag" },
  ],
});
controls.append(shapeControl.wrapper);

// "NEW" badge on Tag option
const tagOption = shapeControl.wrapper.querySelector<HTMLSpanElement>(
  '.toggle-option:last-child span',
);
if (tagOption) {
  const badge = document.createElement("sup");
  badge.className = "toggle-badge-new";
  badge.textContent = "NEW";
  tagOption.appendChild(badge);
}

const levelsControl = stepper("levels", {
  label: "Levels",
  min: String(MIN_LEVELS),
  max: String(MAX_LEVELS),
});
controls.append(levelsControl);

const topExtraToggle = document.createElement("button");
topExtraToggle.type = "button";
topExtraToggle.className = "box-extra-toggle";
topExtraToggle.setAttribute("aria-label", "상단 높이 추가 설정 열기/닫기");
topExtraToggle.title = "상단 높이 추가 설정";

const topExtraControl = rangeControl("top-extra", {
  name: "Top Extra",
  min: String(MIN_TOP_EXTRA),
  max: String(MAX_TOP_EXTRA),
  sliderMin: String(MIN_TOP_EXTRA),
  sliderMax: String(MAX_TOP_EXTRA),
});

const topExtraPanel = document.createElement("div");
topExtraPanel.className = "box-extra-panel";
topExtraPanel.id = "top-extra-panel";
topExtraPanel.append(topExtraControl.wrapper);
topExtraToggle.setAttribute("aria-controls", topExtraPanel.id);

let topExtraOpen = false;
const setTopExtraOpen = (open: boolean) => {
  topExtraOpen = open;
  topExtraPanel.classList.toggle("is-open", open);
  topExtraToggle.setAttribute("aria-expanded", open ? "true" : "false");
  topExtraToggle.textContent = open ? "−" : "+";
};

setTopExtraOpen(false);
topExtraToggle.addEventListener("click", () => {
  setTopExtraOpen(!topExtraOpen);
});

levelsControl.classList.add("levels-control");
const levelsLabel = levelsControl.querySelector("label");
if (levelsLabel) {
  levelsLabel.insertAdjacentElement("afterend", topExtraToggle);
}

controls.append(topExtraPanel);

const widthControl = rangeControl("width", {
  name: "Width",
  min: String(MIN_WIDTH - 2 * START_WALL /* convert from outer to inner */),
  max: String(MAX_WIDTH - 2 * START_WALL),
  sliderMin: String(MIN_WIDTH - 2 * START_WALL),
  sliderMax: "100",
});
controls.append(widthControl.wrapper);

const depthControl = rangeControl("depth", {
  name: "Depth",
  min: String(MIN_DEPTH - 2 * START_WALL /* convert from outer to inner */),
  max: String(MAX_DEPTH - 2 * START_WALL),
  sliderMin: String(MIN_DEPTH - 2 * START_WALL),
  sliderMax: "100",
});
controls.append(depthControl.wrapper);

// Organizer-only controls (Row / Column steppers)
const rowsControl = stepper("grid-rows", {
  label: "Row",
  min: "1",
  max: String(MAX_ROWS + 1),
});
controls.append(rowsControl);

const colsControl = stepper("grid-cols", {
  label: "Column",
  min: "1",
  max: String(MAX_COLS + 1),
});
controls.append(colsControl);

// Tag-only controls
const tagTextControl = textInput("tag-text", {
  label: "Text",
  placeholder: "마음 가는 대로 적어보세요!",
});
controls.append(tagTextControl.wrapper);

const tagWidthControl = rangeControl("tag-width", {
  name: "Width",
  min: String(TAG_MIN_WIDTH),
  max: String(TAG_MAX_WIDTH),
  sliderMin: String(TAG_MIN_WIDTH),
  sliderMax: String(TAG_MAX_WIDTH),
});
controls.append(tagWidthControl.wrapper);

// Restore custom icons from localStorage before building emoji picker
const customIcons = loadCustomIcons();
for (const icon of customIcons) {
  if (!EMOJI_PRESETS.find((p) => p.id === icon.id)) EMOJI_PRESETS.push(icon);
}

const tagEmojiControl = emojiPicker("tag-emoji", EMOJI_PRESETS);
controls.append(tagEmojiControl.wrapper);

// The dimension inputs
const inputs = {
  levels: document.querySelector("#levels")! as HTMLInputElement,
  levelsPlus: document.querySelector("#levels-plus")! as HTMLButtonElement,
  levelsMinus: document.querySelector("#levels-minus")! as HTMLButtonElement,
  topExtra: topExtraControl.input,
  topExtraRange: topExtraControl.range,
  width: widthControl.input,
  widthRange: widthControl.range,
  depth: depthControl.input,
  depthRange: depthControl.range,
  cols: document.querySelector("#grid-cols")! as HTMLInputElement,
  colsPlus: document.querySelector("#grid-cols-plus")! as HTMLButtonElement,
  colsMinus: document.querySelector("#grid-cols-minus")! as HTMLButtonElement,
  rows: document.querySelector("#grid-rows")! as HTMLInputElement,
  rowsPlus: document.querySelector("#grid-rows-plus")! as HTMLButtonElement,
  rowsMinus: document.querySelector("#grid-rows-minus")! as HTMLButtonElement,
} as const;

// Add change events to all dimension inputs

// height/levels
([[inputs.levels, "change"]] as const).forEach(([input, evnt]) => {
  levels.addListener((levels) => {
    input.value = `${levels}`;
  });
  input.addEventListener(evnt, () => {
    const n = parseInt(input.value);
    if (!Number.isNaN(n))
      /* Clamp between min & max (currently synced manually with HTML) */
      levels.send(Math.max(MIN_LEVELS, Math.min(n, MAX_LEVELS)));
  });
});

inputs.levelsPlus.addEventListener("click", () => {
  const n = levels.latest + 1;
  levels.send(Math.max(MIN_LEVELS, Math.min(n, MAX_LEVELS)));
});
levels.addListener((n) => {
  inputs.levelsPlus.disabled = MAX_LEVELS <= n;
  inputs.levelsMinus.disabled = n <= MIN_LEVELS;
});

inputs.levelsMinus.addEventListener("click", () => {
  const n = levels.latest - 1;
  levels.send(Math.max(1, Math.min(n, 5)));
});

// width
innerWidth.addListener((width) => {
  inputs.width.value = `${width}`;
  inputs.widthRange.value = `${width}`;
});
inputs.width.addEventListener("change", () => {
  const outer = parseInt(inputs.width.value) + 2 * modelDimensions.wall.latest;
  if (!Number.isNaN(outer))
    modelDimensions.width.send(Math.max(outer, MIN_WIDTH));
});
inputs.widthRange.addEventListener("input", () => {
  const outer = parseInt(inputs.widthRange.value) + 2 * modelDimensions.wall.latest;
  if (!Number.isNaN(outer))
    modelDimensions.width.send(Math.max(outer, MIN_WIDTH));
});

// depth
innerDepth.addListener((depth) => {
  inputs.depth.value = `${depth}`;
  inputs.depthRange.value = `${depth}`;
});
inputs.depth.addEventListener("change", () => {
  const outer = parseInt(inputs.depth.value) + 2 * modelDimensions.wall.latest;
  if (!Number.isNaN(outer))
    modelDimensions.depth.send(Math.max(outer, MIN_DEPTH));
});
inputs.depthRange.addEventListener("input", () => {
  const outer = parseInt(inputs.depthRange.value) + 2 * modelDimensions.wall.latest;
  if (!Number.isNaN(outer))
    modelDimensions.depth.send(Math.max(outer, MIN_DEPTH));
});

// top extra height (box-only, hidden by default)
topExtra.addListener((extra) => {
  inputs.topExtra.value = `${extra}`;
  inputs.topExtraRange.value = `${extra}`;
});
inputs.topExtra.addEventListener("change", () => {
  const n = parseInt(inputs.topExtra.value);
  if (!Number.isNaN(n))
    topExtra.send(Math.max(MIN_TOP_EXTRA, Math.min(n, MAX_TOP_EXTRA)));
});
inputs.topExtraRange.addEventListener("input", () => {
  const n = parseInt(inputs.topExtraRange.value);
  if (!Number.isNaN(n))
    topExtra.send(Math.max(MIN_TOP_EXTRA, Math.min(n, MAX_TOP_EXTRA)));
});

// Shape selector
shapeControl.inputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) shapeType.send(input.value as ShapeType);
  });
});

shapeType.addListener((shape) => {
  reloadModelNeeded = true;
  // Toggle fill pass: only needed for tag text rendering (saves 2 scene renders/frame)
  renderer.edgePass.fillEnabled = shape === "tag";
  if (shape === "tag") {
    partPositioning.send({ tag: "static", position: 1 });
    if (tagFirstVisit) {
      tagFirstVisit = false;
      tagEmoji.send("wedraw");
    }
  }
});

// Show/hide controls based on shape
const orgOnlyEls: HTMLElement[] = [rowsControl, colsControl];
const tagOnlyEls: HTMLElement[] = [tagTextControl.wrapper, tagWidthControl.wrapper, tagEmojiControl.wrapper];
const boxGridOnlyEls: HTMLElement[] = [levelsControl, topExtraPanel, widthControl.wrapper, depthControl.wrapper];

shapeType.addListener((shape) => {
  orgOnlyEls.forEach(
    (el) => (el.style.display = shape === "organizer" ? "" : "none"),
  );
  tagOnlyEls.forEach(
    (el) => (el.style.display = shape === "tag" ? "" : "none"),
  );
  boxGridOnlyEls.forEach(
    (el) => (el.style.display = shape === "tag" ? "none" : ""),
  );
});

// cols (internal 0 = display 1; at least one of cols/rows must be ≥ 1 internal)
([[inputs.cols, "change"]] as const).forEach(([input, evnt]) => {
  cols.addListener((c) => {
    input.value = `${c + 1}`;
  });
  input.addEventListener(evnt, () => {
    const n = parseInt(input.value);
    if (!Number.isNaN(n)) {
      const c = Math.max(0, Math.min(n - 1, MAX_COLS));
      if (c === 0 && rows.latest === 0) rows.send(1);
      cols.send(c);
    }
  });
});

// rows (same mutual constraint)
([[inputs.rows, "change"]] as const).forEach(([input, evnt]) => {
  rows.addListener((r) => {
    input.value = `${r + 1}`;
  });
  input.addEventListener(evnt, () => {
    const n = parseInt(input.value);
    if (!Number.isNaN(n)) {
      const r = Math.max(0, Math.min(n - 1, MAX_ROWS));
      if (r === 0 && cols.latest === 0) cols.send(1);
      rows.send(r);
    }
  });
});

// Grid stepper buttons (enforce: cols + rows ≥ 1 internal, i.e. no 1×1 grid)
inputs.colsPlus.addEventListener("click", () => {
  cols.send(Math.min(cols.latest + 1, MAX_COLS));
});
inputs.colsMinus.addEventListener("click", () => {
  const c = cols.latest - 1;
  if (c < 0) return;
  if (c === 0 && rows.latest === 0) rows.send(1);
  cols.send(c);
});
inputs.rowsPlus.addEventListener("click", () => {
  rows.send(Math.min(rows.latest + 1, MAX_ROWS));
});
inputs.rowsMinus.addEventListener("click", () => {
  const r = rows.latest - 1;
  if (r < 0) return;
  if (r === 0 && cols.latest === 0) cols.send(1);
  rows.send(r);
});

// Disable buttons at boundaries
cols.addListener((c) => {
  inputs.colsMinus.disabled = c <= 0;
  inputs.colsPlus.disabled = c >= MAX_COLS;
});
rows.addListener((r) => {
  inputs.rowsMinus.disabled = r <= 0;
  inputs.rowsPlus.disabled = r >= MAX_ROWS;
});

// Tag text input — validate width limit and update remaining counter
let lastValidTagText = "";

async function updateTagTextCounter(text: string) {
  if (!text.trim()) {
    tagTextControl.counter.textContent = "";
    tagTextControl.counter.classList.remove("at-limit");
    return;
  }
  const textW = await measureTextWidth(text, TAG_TEXT_AREA_HEIGHT);
  const remaining = TAG_MAX_TEXT_CONTENT_WIDTH - textW;
  // Estimate remaining chars from average character width
  const avgCharW = textW / text.length;
  const remainingChars = Math.max(0, Math.floor(remaining / avgCharW));
  tagTextControl.counter.textContent = `${remainingChars}`;
  tagTextControl.counter.classList.toggle("at-limit", remainingChars <= 0);
}

tagTextControl.input.addEventListener("input", () => {
  const text = tagTextControl.input.value;
  // Debounce text changes to avoid excessive model reloads
  clearTimeout(tagTextDebounceTimer);
  tagTextDebounceTimer = setTimeout(async () => {
    const textW = await measureTextWidth(text, TAG_TEXT_AREA_HEIGHT);
    if (textW > TAG_MAX_TEXT_CONTENT_WIDTH && text.length > lastValidTagText.length) {
      // Revert to last valid text
      tagTextControl.input.value = lastValidTagText;
      updateTagTextCounter(lastValidTagText);
      return;
    }
    lastValidTagText = text;
    tagText.send(text);
    updateTagTextCounter(text);
  }, 300);
});

// Tag width
tagWidth.addListener((w) => {
  tagWidthControl.input.value = `${w}`;
  tagWidthControl.range.value = `${w}`;
});
tagWidthControl.input.addEventListener("change", () => {
  const n = parseInt(tagWidthControl.input.value);
  if (!Number.isNaN(n))
    tagWidth.send(Math.max(TAG_MIN_WIDTH, Math.min(n, TAG_MAX_WIDTH)));
});
tagWidthControl.range.addEventListener("input", () => {
  const n = parseInt(tagWidthControl.range.value);
  if (!Number.isNaN(n))
    tagWidth.send(Math.max(TAG_MIN_WIDTH, Math.min(n, TAG_MAX_WIDTH)));
});

// Shared emoji toggle logic for any emoji button
const wireEmojiButton = (btn: HTMLButtonElement) => {
  btn.addEventListener("click", () => {
    const emojiId = btn.dataset.emojiId!;
    if (tagEmoji.latest === emojiId) {
      tagEmoji.send(null);
    } else {
      tagEmoji.send(emojiId);
      tagText.send("");
      tagTextControl.input.value = "";
      lastValidTagText = "";
      tagTextControl.counter.textContent = "";
      tagTextControl.counter.classList.remove("at-limit");
    }
  });
};

// Tag emoji picker
tagEmojiControl.buttons.forEach(wireEmojiButton);

// "+" button — open icon search modal
tagEmojiControl.moreButton.addEventListener("click", async () => {
  const preset = await openIconSearchModal();
  if (!preset) return;

  // Add to global presets array (for downstream find())
  if (!EMOJI_PRESETS.find((p) => p.id === preset.id)) {
    EMOJI_PRESETS.push(preset);
  }

  // Persist to localStorage
  saveCustomIcon(preset);

  // Add button to DOM (unless it already exists)
  const existing = tagEmojiControl.grid.querySelector(
    `button[data-emoji-id="${CSS.escape(preset.id)}"]`,
  );
  if (!existing) {
    const btn = addEmojiButton(
      tagEmojiControl.grid,
      tagEmojiControl.moreButton,
      preset,
    );
    tagEmojiControl.buttons.push(btn);
    wireEmojiButton(btn);
  }

  // Select the new icon immediately
  tagEmoji.send(preset.id);
});

// Update emoji button selection state
tagEmoji.addListener((selected) => {
  tagEmojiControl.buttons.forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.emojiId === selected);
  });
});

// When text is typed, deselect emoji
tagText.addListener((text) => {
  if (text.trim()) {
    tagEmoji.send(null);
  }
});

// Add select-all on input click
(["levels", "topExtra", "width", "depth"] as const).forEach((dim) => {
  const input = inputs[dim];
  input.addEventListener("focus", () => {
    input.select();
  });
});

/* Extract X & Y from event (offsetX/Y) */
const eventCoords = (e: MouseEvent | TouchEvent): [number, number] => {
  // Simple case of a mouse event
  if (e instanceof MouseEvent) {
    return [e.offsetX, e.offsetY];
  }

  // Now, try to extract values similar to offsetXY from a TouchEvent, if possible
  const target = e.target;
  if (!target) {
    console.warn("Event doesn't have target", e);
    return [0, 0];
  }

  if (!(target instanceof HTMLElement)) {
    console.warn("Event target is not an element", e);
    return [0, 0];
  }

  const rect = target.getBoundingClientRect();
  const x = e.targetTouches[0].clientX - rect.x;
  const y = e.targetTouches[0].clientY - rect.y;
  return [x, y];
};

/* Get ready on first touchdown */

const readyMouseTarget = canvas;
const readyMouseEvents = ["mousedown", "touchstart"] as const;
const readyMouse = (e: MouseEvent | TouchEvent) => {
  renderer.render();

  const [x, y] = eventCoords(e);
  const [r, g, b, a] = renderer.readPixel([x, y]);

  // The outline rendering renders transparent pixels outside of the part
  // So if it's transparent, assume the user didn't want to touch/rotate the part
  if (r === 0 && g === 0 && b === 0 && a === 0) {
    return;
  }

  e.preventDefault(); // Prevent from scrolling the page while moving the part
  partPositioning.update((val) => {
    if (val.tag === "will-move" || val.tag === "moving") {
      return val;
    } else {
      const clock = new THREE.Clock();
      clock.start();
      return {
        tag: "will-move",
        startRot: rotation.current,
        startPos: [x, y],
        clock,
        lastStatic: val,
      };
    }
  });

  trackMouseEvents.forEach((evt) =>
    trackMouseTarget.addEventListener(evt, trackMouse, { passive: false }),
  );
  forgetMouseEvents.forEach((evt) =>
    forgetMouseTarget.addEventListener(evt, forgetMouse),
  );
};

readyMouseEvents.forEach((evt) =>
  readyMouseTarget.addEventListener(evt, readyMouse),
);

/* Start tracking mouse mouvement across the window */
const trackMouseTarget = window;
const trackMouseEvents = ["mousemove", "touchmove"] as const;
const trackMouse = (e: MouseEvent | TouchEvent) => {
  const [x] = eventCoords(e);

  partPositioning.update((val) => {
    if (val.tag === "will-move" || val.tag === "moving") {
      return {
        tag: "moving",
        x,

        startPos: val.startPos,
        startRot: val.startRot,
        lastStatic: val.lastStatic,
        clock: val.clock,
      };
    }

    // This is technically not possible, unless the browser sends events
    // in incorrect order
    val.tag satisfies "static";
    return val;
  });
};

const forgetMouseTarget = window;
const forgetMouseEvents = ["mouseup", "touchend"] as const;
const forgetMouse = () => {
  trackMouseEvents.forEach((evt) =>
    trackMouseTarget.removeEventListener(evt, trackMouse),
  );
  forgetMouseEvents.forEach((evt) =>
    forgetMouseTarget.removeEventListener(evt, forgetMouse),
  );

  /* toggle static positioning between front & back */
  const toggle = (p: PartPositionStatic): PartPositionStatic =>
    ({
      [-1]: { tag: "static", position: 0 } as const,
      [0]: { tag: "static", position: 1 } as const,
      [1]: { tag: "static", position: 0 } as const,
    })[p.position];

  partPositioning.update((was) => {
    if (was.tag === "will-move") {
      // Mouse was down but didn't move, assume toggle
      return toggle(was.lastStatic);
    } else if (was.tag === "static") {
      // Mouse was down and up, i.e. "clicked", toggle
      return toggle(was);
    } else {
      // Mouse has moved
      was.tag satisfies "moving";

      // If the move was too short, assume toggle (jerk)
      const elapsed = was.clock.getElapsedTime();
      const delta = Math.abs(was.x - was.startPos[0]);
      if (elapsed < 0.3 && delta < 15) {
        return toggle(was.lastStatic);
      }

      // Snap part to one of the static positions
      const rounded = Math.round(bound(rotation.current, [-1, 1]));
      if (rounded <= -1) {
        return { tag: "static", position: -1 };
      } else if (1 <= rounded) {
        return { tag: "static", position: 1 };
      } else {
        return { tag: "static", position: 0 };
      }
    }
  });
};

/// LOOP

// Set to current frame's timestamp when a model starts loading, and set
// to undefined when the model has finished loading
let modelLoadStarted: undefined | DOMHighResTimeStamp;
let lastModelLoadFinished: DOMHighResTimeStamp = 0;

// Minimum ms between CSG rebuild completions. A small interval gives the main
// thread just enough breathing room for input events between CSG calls.
// The download-model build is debounced separately (TMF_DEBOUNCE_MS), so only
// one CSG (the preview) runs per cycle during slider drag.
const MODEL_REBUILD_INTERVAL = 16; // ~1 frame at 60fps

function loop(nowMillis: DOMHighResTimeStamp) {
  requestAnimationFrame(loop);

  // Reload 3mf if necessary
  if (shapeType.latest === "tag") {
    // Tag download is handled via click event, not tmfLoader
  } else {
    const newTmf = tmfLoader.take();
    if (newTmf !== undefined) {
      // Update the download link
      link.href = URL.createObjectURL(newTmf.blob);
      link.download = newTmf.filename;
    }
  }

  // Handle rotation animation
  const rotationUpdated = rotation.update();
  if (rotationUpdated) {
    mesh.rotation.z = rotation.current * Math.PI + MESH_ROTATION_DELTA;
  }

  // Handle dimensions animation
  const dimensionsUpdated = DIMENSIONS.reduce(
    (acc, dim) => animations[dim].update() || acc,
    false,
  );

  const organizerUpdated = ORGANIZER_DIMS.reduce(
    (acc, dim) => organizerAnimations[dim].update() || acc,
    false,
  );

  const hookReferenceUpdated = hookReferenceAnimation.update();

  const tagWidthUpdated = tagWidthAnimation.update();

  if (dimensionsUpdated || organizerUpdated || hookReferenceUpdated || tagWidthUpdated) {
    reloadModelNeeded = true;
  }

  // Whether we should start loading a new model on this frame:
  //   (1) model needs reloading
  //   (2) no model is currently loading (or loading seems stuck)
  //   (3) enough time has passed since last rebuild finished (throttle)
  const reloadModelNow =
    reloadModelNeeded &&
    (modelLoadStarted === undefined || nowMillis - modelLoadStarted > 200) &&
    nowMillis - lastModelLoadFinished >= MODEL_REBUILD_INTERVAL;

  if (reloadModelNow) {
    modelLoadStarted = nowMillis;
    reloadModelNeeded = false;
    reloadModel(
      animations["height"].current,
      hookReferenceAnimation.current,
      animations["width"].current,
      animations["depth"].current,
      animations["radius"].current,
      animations["wall"].current,
      animations["bottom"].current,
      shapeType.latest,
      organizerAnimations.cols.current,
      organizerAnimations.rows.current,
    ).then(() => {
      modelLoadStarted = undefined;
      lastModelLoadFinished = performance.now();
      centerCameraNeeded = true;
    });
  }

  const canvasResized = renderer.resizeCanvas();

  if (canvasResized) {
    centerCameraNeeded = true;
  }

  if (centerCameraNeeded) {
    centerCamera();
    centerCameraNeeded = false;
  }

  renderer.render();
}

// performance.now() is equivalent to the timestamp supplied by
// requestAnimationFrame
//
// https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
loop(performance.now());
