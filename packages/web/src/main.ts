import "./style.css";

import * as THREE from "three";
import { Renderer } from "./rendering/renderer";

import { CLIP_HEIGHT, box, drawerOrganizer } from "./model/manifold";
import { exportManifold, exportManifoldBytes, exportTagParts, mesh2geometry } from "./model/export";
import { TMFLoader } from "./model/load";
import { Animate, immediate } from "./animate";
import { zipSync } from "fflate";
import { tagBody, tagTextPlate, tagPreview, TAG_DEFAULT_WIDTH, TAG_MIN_WIDTH, TAG_MAX_WIDTH } from "./model/tag";
import { EMOJI_PRESETS } from "./model/emoji";

import { Dyn } from "twrl";

import { rangeControl, stepper, toggleControl, textInput, emojiPicker } from "./controls";

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

const modelForSnapshot = (snapshot: ModelSnapshot) => {
  if (snapshot.shape === "tag") {
    return tagPreview(snapshot.width, snapshot.tagText, snapshot.tagEmoji);
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
  if (snapshot.shape === "tag") return `palagg-tag-${snapshot.width}`;
  return snapshot.shape === "organizer"
    ? `palagg-organizer-${snapshot.width}-${snapshot.depth}-${snapshot.height}.3mf`
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
  if (shape === "tag") {
    model = await tagPreview(tagWidthAnimation.current, tagText.latest, tagEmoji.latest);
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
  geometry.computeVertexNormals(); // Make sure the geometry has normals
  mesh.geometry = geometry;
  mesh.clear(); // Remove all children
}

// when target dimensions are changed, update the model to download
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
    const filename = filenameForSnapshot(snapshot);
    const modelP = modelForSnapshot(snapshot);
    tmfLoader.load(modelP, filename);
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
  renderer.centerCameraAround(mesh, mat);
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

// Update download button text for tag mode
shapeType.addListener((shape) => {
  link.textContent = "3MF 다운로드";
});

// Handle tag download via click
link.addEventListener("click", async (e) => {
  if (shapeType.latest !== "tag") return; // Let default <a> behavior handle non-tag
  e.preventDefault();

  const snapshot = buildSnapshot();
  const baseName = filenameForSnapshot(snapshot);
  const body = await tagBody(snapshot.width);
  const plate = await tagTextPlate(snapshot.width, snapshot.tagText, snapshot.tagEmoji);
  const blob = exportTagParts(body, plate, baseName);

  if (tagDownloadUrl) URL.revokeObjectURL(tagDownloadUrl);
  tagDownloadUrl = URL.createObjectURL(blob);

  const tempLink = document.createElement("a");
  tempLink.href = tagDownloadUrl;
  tempLink.download = `${baseName}.zip`;
  tempLink.click();
});

const renderOrderSheet = () => {
  const totalQuantity = orderLines.reduce((sum, line) => sum + line.quantity, 0);
  orderSummary.textContent = `총 ${totalQuantity}개의 PÅLÄGG`;

  if (orderLines.length === 0) {
    orderItemsList.innerHTML =
      '<li class="order-items-empty">아직 추가된 주문이 없습니다.</li>';
    placeOrderButton.disabled = true;
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

  placeOrderButton.disabled = false;
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

const downloadOrderAsZip = async () => {
  if (orderLines.length === 0) return;

  placeOrderButton.disabled = true;
  placeOrderButton.textContent = "주문 파일 생성 중...";

  try {
    const files: Record<string, Uint8Array> = {};
    const filenameCounts = new Map<string, number>();
    for (const line of orderLines) {
      if (line.snapshot.shape === "tag") {
        // Tag: export body + plate as separate 3mf files
        const body = await tagBody(line.snapshot.width);
        const plate = await tagTextPlate(line.snapshot.width, line.snapshot.tagText, line.snapshot.tagEmoji);
        const bodyBytes = exportManifoldBytes(body);
        const plateBytes = exportManifoldBytes(plate);

        for (let i = 0; i < line.quantity; i++) {
          const count = (filenameCounts.get(line.filename) ?? 0) + 1;
          filenameCounts.set(line.filename, count);
          const suffix = count === 1 ? "" : `-${count}`;
          files[`${line.filename}${suffix}-body.3mf`] = bodyBytes;
          files[`${line.filename}${suffix}-plate.3mf`] = plateBytes;
        }
      } else {
        const model = await modelForSnapshot(line.snapshot);
        const blob = exportManifold(model);
        const bytes = new Uint8Array(await blob.arrayBuffer());

        for (let i = 0; i < line.quantity; i++) {
          const lastDot = line.filename.lastIndexOf(".");
          const base =
            lastDot >= 0 ? line.filename.slice(0, lastDot) : line.filename;
          const ext = lastDot >= 0 ? line.filename.slice(lastDot) : "";
          const count = (filenameCounts.get(line.filename) ?? 0) + 1;
          filenameCounts.set(line.filename, count);
          const uniqueFilename =
            count === 1 ? line.filename : `${base}-${count}${ext}`;

          files[uniqueFilename] = bytes;
        }
      }
    }

    const zipBytes = zipSync(files);
    const zipBlob = new Blob([Uint8Array.from(zipBytes)], {
      type: "application/zip",
    });

    if (orderZipUrl) {
      URL.revokeObjectURL(orderZipUrl);
    }

    orderZipUrl = URL.createObjectURL(zipBlob);
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
    const tempLink = document.createElement("a");
    tempLink.href = orderZipUrl;
    tempLink.download = `palagg-order-${stamp}.zip`;
    tempLink.click();

    orderLines.length = 0;
    renderOrderSheet();
  } finally {
    placeOrderButton.textContent = "한번에 주문하기";
    placeOrderButton.disabled = orderLines.length === 0;
  }
};

addToOrderButton.addEventListener("click", addCurrentSelectionToOrder);
placeOrderButton.addEventListener("click", async () => {
  try {
    await downloadOrderAsZip();
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
  placeholder: "이름을 입력하세요",
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
(
  [
    [inputs.width, "change"],
    [inputs.widthRange, "input"],
  ] as const
).forEach(([input, evnt]) => {
  innerWidth.addListener((width) => {
    input.value = `${width}`;
  });
  input.addEventListener(evnt, () => {
    const outer = parseInt(input.value) + 2 * modelDimensions.wall.latest;
    if (!Number.isNaN(outer))
      modelDimensions.width.send(Math.max(outer, MIN_WIDTH));
  });
});

// depth
(
  [
    [inputs.depth, "change"],
    [inputs.depthRange, "input"],
  ] as const
).forEach(([input, evnt]) => {
  innerDepth.addListener((depth) => {
    input.value = `${depth}`;
  });
  input.addEventListener(evnt, () => {
    const outer = parseInt(input.value) + 2 * modelDimensions.wall.latest;
    if (!Number.isNaN(outer))
      modelDimensions.depth.send(Math.max(outer, MIN_DEPTH));
  });
});

// top extra height (box-only, hidden by default)
(
  [
    [inputs.topExtra, "change"],
    [inputs.topExtraRange, "input"],
  ] as const
).forEach(([input, evnt]) => {
  topExtra.addListener((extra) => {
    input.value = `${extra}`;
  });
  input.addEventListener(evnt, () => {
    const n = parseInt(input.value);
    if (!Number.isNaN(n)) {
      topExtra.send(Math.max(MIN_TOP_EXTRA, Math.min(n, MAX_TOP_EXTRA)));
    }
  });
});

// Shape selector
shapeControl.inputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (input.checked) shapeType.send(input.value as ShapeType);
  });
});

shapeType.addListener(() => {
  reloadModelNeeded = true;
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

// Tag text input
tagTextControl.input.addEventListener("input", () => {
  const text = tagTextControl.input.value;
  // Debounce text changes to avoid excessive model reloads
  clearTimeout(tagTextDebounceTimer);
  tagTextDebounceTimer = setTimeout(() => {
    tagText.send(text);
  }, 300);
});

// Tag width
(
  [
    [tagWidthControl.input, "change"],
    [tagWidthControl.range, "input"],
  ] as const
).forEach(([input, evnt]) => {
  tagWidth.addListener((w) => {
    input.value = `${w}`;
  });
  input.addEventListener(evnt, () => {
    const n = parseInt(input.value);
    if (!Number.isNaN(n))
      tagWidth.send(Math.max(TAG_MIN_WIDTH, Math.min(n, TAG_MAX_WIDTH)));
  });
});

// Tag emoji picker
tagEmojiControl.buttons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const emojiId = btn.dataset.emojiId!;
    if (tagEmoji.latest === emojiId) {
      // Deselect
      tagEmoji.send(null);
    } else {
      tagEmoji.send(emojiId);
      // Clear text when emoji is selected
      tagText.send("");
      tagTextControl.input.value = "";
    }
  });
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
  const [r, g, b, a] = renderer.getCanvasPixelColor([x, y]);

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

  // Whether we should start loading a new model on this frame
  // True if (1) model needs reloading and (2) no model is currently loading (or
  // if loading seems stuck)
  const reloadModelNow =
    reloadModelNeeded &&
    (modelLoadStarted === undefined || nowMillis - modelLoadStarted > 100);

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
