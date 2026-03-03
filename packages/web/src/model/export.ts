import {
  fileForContentTypes,
  FileForRelThumbnail,
  to3dmodel,
} from "@jscadui/3mf-export";
import type { Manifold } from "manifold-3d";

import * as THREE from "three";
import { strToU8, Zippable, zipSync } from "fflate";

interface Component3MF {
  id: string;
  children: Array<{ objectID: string; transform?: number[] }>;
  name?: string;
}

interface To3MF {
  meshes: Array<Mesh3MF>;
  components: Array<Component3MF>;
  items: Array<{ objectID: string }>;
  precision: number;
  header: Header;
}

interface Mesh3MF {
  id: string;
  vertices: Float32Array;
  indices: Uint32Array;
  name?: string;
}

interface Header {
  unit?: "micron" | "millimeter" | "centimeter" | "inch" | "foot" | "meter";
  title?: string;
  author?: string;
  description?: string;
  application?: string;
  creationDate?: string;
  license?: string;
  modificationDate?: string;
}

export function exportManifoldBytes(manifold: Manifold): Uint8Array {
  const manifoldMesh = manifold.getMesh();

  const vertices =
    manifoldMesh.numProp === 3
      ? manifoldMesh.vertProperties
      : new Float32Array(manifoldMesh.numVert * 3);

  if (manifoldMesh.numProp > 3) {
    for (let i = 0; i < manifoldMesh.numVert; ++i) {
      for (let j = 0; j < 3; ++j)
        vertices[i * 3 + j] =
          manifoldMesh.vertProperties[i * manifoldMesh.numProp + j];
    }
  }

  const to3mf: To3MF = {
    meshes: [{ vertices, indices: manifoldMesh.triVerts, id: "0" }],
    components: [],
    items: [{ objectID: "0" }],
    precision: 7,

    header: {
      unit: "millimeter",
      title: "palagg-ikea-skadis",
      description: "",
      application: "",
    },
  };

  const model = to3dmodel(to3mf);

  const files: Zippable = {};

  const fileForRelThumbnail = new FileForRelThumbnail();
  fileForRelThumbnail.add3dModel("3D/3dmodel.model");
  files["3D/3dmodel.model"] = strToU8(model);
  files[fileForContentTypes.name] = strToU8(fileForContentTypes.content);
  files[fileForRelThumbnail.name] = strToU8(fileForRelThumbnail.content);
  return zipSync(files);
}

export function exportManifold(manifold: Manifold): Blob {
  const zipFile = exportManifoldBytes(manifold);
  return new Blob([zipFile], {
    type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
  });
}

export interface MultiBodyPart {
  manifold: Manifold;
  name: string;
  color?: string; // hex color, e.g. "#000000"
}

export function exportMultiBodyManifold(bodies: MultiBodyPart[]): Blob {
  const meshes: Mesh3MF[] = [];

  for (let i = 0; i < bodies.length; i++) {
    const { manifold, name } = bodies[i];
    const manifoldMesh = manifold.getMesh();
    const id = String(i + 1); // 3MF IDs start from 1

    const vertices =
      manifoldMesh.numProp === 3
        ? manifoldMesh.vertProperties
        : new Float32Array(manifoldMesh.numVert * 3);

    if (manifoldMesh.numProp > 3) {
      for (let v = 0; v < manifoldMesh.numVert; ++v) {
        for (let j = 0; j < 3; ++j)
          vertices[v * 3 + j] =
            manifoldMesh.vertProperties[v * manifoldMesh.numProp + j];
      }
    }

    meshes.push({ vertices, indices: manifoldMesh.triVerts, id, name });
  }

  // Assembly object groups all bodies as components of a single object.
  // This lets slicers (Bambu Studio, PrusaSlicer) treat them as one
  // multi-part model with per-part material assignment.
  const assemblyId = String(bodies.length + 1);

  const to3mf: To3MF = {
    meshes,
    components: [
      {
        id: assemblyId,
        children: meshes.map((m) => ({ objectID: m.id })),
      },
    ],
    items: [{ objectID: assemblyId }],
    precision: 7,
    header: {
      unit: "millimeter",
      title: "palagg-ikea-skadis",
      description: "",
      application: "",
    },
  };

  let model = to3dmodel(to3mf);

  // Post-process XML: inject <basematerials> and pid/pindex for colored bodies
  const colorEntries: { index: number; color: string }[] = [];
  for (let i = 0; i < bodies.length; i++) {
    if (bodies[i].color) {
      colorEntries.push({ index: i, color: bodies[i].color! });
    }
  }

  if (colorEntries.length > 0) {
    const uniqueColors = [...new Set(colorEntries.map((e) => e.color))];
    const baseMaterialsId = String(bodies.length + 2);

    const baseLines = uniqueColors.map((c) => {
      const hex = c.startsWith("#") ? c : `#${c}`;
      const displayColor = hex.length === 7 ? `${hex}FF` : hex;
      return `    <base name="${hex}" displaycolor="${displayColor}" />`;
    });
    const baseMaterialsXml =
      `  <basematerials id="${baseMaterialsId}">\n${baseLines.join("\n")}\n  </basematerials>\n`;

    model = model.replace("<resources>\n", "<resources>\n" + baseMaterialsXml);

    // Per-triangle material: Bambu Studio / OrcaSlicer read pid/p1/p2/p3
    // on <triangle> elements (triggers "Standard 3MF Import Color" dialog).
    for (const entry of colorEntries) {
      const objId = String(entry.index + 1);
      const pindex = uniqueColors.indexOf(entry.color);

      const objStart = model.indexOf(`<object id="${objId}"`);
      const objEnd = model.indexOf("</object>", objStart) + "</object>".length;
      let section = model.substring(objStart, objEnd);

      section = section.replace(
        /(<triangle v1="\d+" v2="\d+" v3="\d+") \/>/g,
        `$1 pid="${baseMaterialsId}" p1="${pindex}" p2="${pindex}" p3="${pindex}" />`,
      );

      model = model.substring(0, objStart) + section + model.substring(objEnd);
    }
  }

  const files: Zippable = {};
  const fileForRelThumbnail = new FileForRelThumbnail();
  fileForRelThumbnail.add3dModel("3D/3dmodel.model");
  files["3D/3dmodel.model"] = strToU8(model);
  files[fileForContentTypes.name] = strToU8(fileForContentTypes.content);
  files[fileForRelThumbnail.name] = strToU8(fileForRelThumbnail.content);

  const zipFile = zipSync(files);
  return new Blob([zipFile], {
    type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
  });
}

// ─── Build Plate Export (single 3MF with all order items) ───

export interface BuildPlateGroup {
  bodies: MultiBodyPart[];
  quantity: number;
  name?: string;
}

interface Placement {
  groupIndex: number;
  plate: number;
  tx: number;
  ty: number;
}

interface GroupBBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  width: number;
  depth: number;
}

function computeGroupBBox(bodies: MultiBodyPart[]): GroupBBox {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const { manifold } of bodies) {
    const bb = manifold.boundingBox();
    minX = Math.min(minX, bb.min[0]);
    minY = Math.min(minY, bb.min[1]);
    minZ = Math.min(minZ, bb.min[2]);
    maxX = Math.max(maxX, bb.max[0]);
    maxY = Math.max(maxY, bb.max[1]);
    maxZ = Math.max(maxZ, bb.max[2]);
  }
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    width: maxX - minX,
    depth: maxY - minY,
  };
}

const BUILD_PLATE_W = 200;
const BUILD_PLATE_D = 200;
const BUILD_PLATE_GAP = 5;
/** X offset per plate in global coords (matches Bambu Studio pattern). */
const PLATE_SPACING = BUILD_PLATE_W + 140;

/**
 * Shelf bin-packing: sort items by depth descending, place left→right,
 * wrap to next shelf when row is full, advance to next plate when plate overflows.
 */
function layoutOnBuildPlate(
  groups: BuildPlateGroup[],
  bboxes: GroupBBox[],
  plateW = BUILD_PLATE_W,
  plateD = BUILD_PLATE_D,
  gap = BUILD_PLATE_GAP,
): Placement[] {
  const items: { groupIndex: number; width: number; depth: number }[] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let q = 0; q < groups[i].quantity; q++) {
      items.push({
        groupIndex: i,
        width: bboxes[i].width,
        depth: bboxes[i].depth,
      });
    }
  }
  items.sort((a, b) => b.depth - a.depth);

  const placements: Placement[] = [];
  let plate = 0,
    curX = 0,
    curY = 0,
    shelfH = 0;

  for (const item of items) {
    if (curX + item.width > plateW) {
      curY += shelfH + gap;
      curX = 0;
      shelfH = 0;
    }
    if (curY + item.depth > plateD) {
      plate++;
      curX = 0;
      curY = 0;
      shelfH = 0;
    }
    placements.push({ groupIndex: item.groupIndex, plate, tx: curX, ty: curY });
    curX += item.width + gap;
    shelfH = Math.max(shelfH, item.depth);
  }
  return placements;
}

function extractVertices(manifold: Manifold): {
  vertices: Float32Array;
  indices: Uint32Array;
} {
  const m = manifold.getMesh();
  const np = m.numProp;
  if (np === 3) return { vertices: m.vertProperties, indices: m.triVerts };
  const vertices = new Float32Array(m.numVert * 3);
  for (let i = 0; i < m.numVert; i++) {
    vertices[i * 3] = m.vertProperties[i * np];
    vertices[i * 3 + 1] = m.vertProperties[i * np + 1];
    vertices[i * 3 + 2] = m.vertProperties[i * np + 2];
  }
  return { vertices, indices: m.triVerts };
}

/**
 * Export all order groups onto 200×200mm build plates as a single 3MF.
 * Identical groups reuse the same mesh objects (geometry deduplication).
 * Includes Bambu Studio model_settings.config for multi-plate + multi-color.
 */
export function exportBuildPlate3MF(groups: BuildPlateGroup[]): Blob {
  const bboxes = groups.map((g) => computeGroupBBox(g.bodies));
  const placements = layoutOnBuildPlate(groups, bboxes);

  // ── ID assignment ──
  // Mesh object IDs: sequential from 1, one per body per unique group
  const groupMeshStart: number[] = [];
  let nextId = 1;
  for (let g = 0; g < groups.length; g++) {
    groupMeshStart[g] = nextId;
    nextId += groups[g].bodies.length;
  }
  // Assembly object IDs: one per PLACEMENT (not per group).
  // Bambu Studio needs a unique assembly ID per instance so that
  // model_settings.config can assign name + extruder to each one.
  // Mesh objects are still shared across assemblies of the same group.
  const placementAsmId: number[] = [];
  for (let i = 0; i < placements.length; i++) {
    placementAsmId[i] = nextId++;
  }
  // Collect unique colors for basematerials
  const colors: string[] = [];
  for (const group of groups) {
    for (const body of group.bodies) {
      if (body.color && !colors.includes(body.color)) colors.push(body.color);
    }
  }
  const matId = colors.length > 0 ? nextId++ : -1;

  // ── 3D Model XML ──
  let model = '<?xml version="1.0" encoding="UTF-8"?>\n';
  model +=
    '<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n';
  model += "<resources>\n";

  // Basematerials (only when colored bodies exist)
  if (colors.length > 0) {
    model += `<basematerials id="${matId}">\n`;
    for (const c of colors) {
      const hex = c.startsWith("#") ? c : `#${c}`;
      const dc = hex.length === 7 ? hex + "FF" : hex;
      model += `  <base name="${hex}" displaycolor="${dc}" />\n`;
    }
    model += "</basematerials>\n";
  }

  // Mesh objects: one per body per unique group (shared across placements)
  for (let g = 0; g < groups.length; g++) {
    for (let b = 0; b < groups[g].bodies.length; b++) {
      const body = groups[g].bodies[b];
      const id = groupMeshStart[g] + b;
      const { vertices, indices } = extractVertices(body.manifold);

      model += `<object id="${id}" type="model" name="${body.name}">\n`;
      model += "<mesh>\n<vertices>\n";
      for (let i = 0; i < vertices.length; i += 3) {
        model += `<vertex x="${vertices[i]}" y="${vertices[i + 1]}" z="${vertices[i + 2]}" />\n`;
      }
      model += "</vertices>\n<triangles>\n";

      const colorIdx = body.color ? colors.indexOf(body.color) : -1;
      for (let i = 0; i < indices.length; i += 3) {
        if (colorIdx >= 0) {
          model += `<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}" pid="${matId}" p1="${colorIdx}" p2="${colorIdx}" p3="${colorIdx}" />\n`;
        } else {
          model += `<triangle v1="${indices[i]}" v2="${indices[i + 1]}" v3="${indices[i + 2]}" />\n`;
        }
      }
      model += "</triangles>\n</mesh>\n</object>\n";
    }
  }

  // Assembly objects: one per PLACEMENT, referencing its group's mesh objects
  for (let i = 0; i < placements.length; i++) {
    const g = placements[i].groupIndex;
    model += `<object id="${placementAsmId[i]}" type="model">\n<components>\n`;
    for (let b = 0; b < groups[g].bodies.length; b++) {
      model += `<component objectid="${groupMeshStart[g] + b}" />\n`;
    }
    model += "</components>\n</object>\n";
  }

  model += "</resources>\n<build>\n";

  // Build items: one per placement, each with its own assembly + transform.
  // Bambu Studio uses GLOBAL coordinates — plate N items are X-offset by
  // N * PLATE_SPACING so the slicer can distinguish plates spatially.
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const bb = bboxes[p.groupIndex];
    const tx = p.tx - bb.minX + p.plate * PLATE_SPACING;
    const ty = p.ty - bb.minY;
    const tz = -bb.minZ;
    model += `<item objectid="${placementAsmId[i]}" transform="1 0 0 0 1 0 0 0 1 ${tx} ${ty} ${tz}" />\n`;
  }
  model += "</build>\n</model>\n";

  // ── Model Settings (Bambu Studio multi-plate + multi-color) ──
  let settings = '<?xml version="1.0" encoding="UTF-8"?>\n<config>\n';

  // One <object> per placement assembly — each gets its own name + extruder
  for (let i = 0; i < placements.length; i++) {
    const g = placements[i].groupIndex;
    const name = groups[g].name ?? groups[g].bodies[0]?.name ?? `part-${g}`;
    settings += `<object id="${placementAsmId[i]}">\n`;
    settings += `  <metadata key="name" value="${name}"/>\n`;
    settings += '  <metadata key="extruder" value="1"/>\n';
    for (let b = 0; b < groups[g].bodies.length; b++) {
      const body = groups[g].bodies[b];
      settings += `  <part id="${groupMeshStart[g] + b}" subtype="normal_part">\n`;
      settings += `    <metadata key="name" value="${body.name}"/>\n`;
      settings += `    <metadata key="extruder" value="${body.color ? "2" : "1"}"/>\n`;
      settings += "  </part>\n";
    }
    settings += "</object>\n";
  }

  // Plate entries: group placements by plate number
  const plateMap = new Map<number, number[]>();
  for (let i = 0; i < placements.length; i++) {
    const pn = placements[i].plate;
    if (!plateMap.has(pn)) plateMap.set(pn, []);
    plateMap.get(pn)!.push(i);
  }

  for (const [plateNum, indices] of [...plateMap.entries()].sort(
    (a, b) => a[0] - b[0],
  )) {
    settings += "<plate>\n";
    settings += `  <metadata key="plater_id" value="${plateNum + 1}"/>\n`;
    settings += '  <metadata key="locked" value="false"/>\n';
    for (const idx of indices) {
      settings += "  <model_instance>\n";
      settings += `    <metadata key="object_id" value="${placementAsmId[idx]}"/>\n`;
      settings += '    <metadata key="instance_id" value="0"/>\n';
      settings += '    <metadata key="identify_id" value="0"/>\n';
      settings += "  </model_instance>\n";
    }
    settings += "</plate>\n";
  }
  settings += "</config>\n";

  // ── ZIP package ──
  const files: Zippable = {};
  const fileForRelThumbnail = new FileForRelThumbnail();
  fileForRelThumbnail.add3dModel("3D/3dmodel.model");
  files["3D/3dmodel.model"] = strToU8(model);
  files["Metadata/model_settings.config"] = strToU8(settings);
  files[fileForContentTypes.name] = strToU8(fileForContentTypes.content);
  files[fileForRelThumbnail.name] = strToU8(fileForRelThumbnail.content);

  return new Blob([zipSync(files)], {
    type: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
  });
}

export function mesh2geometry(manifold: Manifold): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const geometry = new THREE.BufferGeometry();
  const verts: Float32Array = new Float32Array(3 * mesh.triVerts.length);
  const np = mesh.numProp;

  // List the indices, and for each copy the original vertex.
  // Non-indexed geometry so each face owns its vertices independently.
  mesh.triVerts.forEach((ix, i) => {
    verts[3 * i + 0] = mesh.vertProperties[np * ix + 0];
    verts[3 * i + 1] = mesh.vertProperties[np * ix + 1];
    verts[3 * i + 2] = mesh.vertProperties[np * ix + 2];
  });

  geometry.setAttribute("position", new THREE.BufferAttribute(verts, 3));
  return geometry;
}

/**
 * Compute crease-angle normals: smooth normals on near-coplanar faces,
 * keep sharp (flat) normals at edges where face angle exceeds the threshold.
 * This eliminates facet edge artifacts on curved surfaces (e.g. tag stadium)
 * while preserving sharp edges on boxes and chamfers.
 */
export function computeCreaseNormals(
  geometry: THREE.BufferGeometry,
  creaseAngle: number,
): void {
  const positions = geometry.getAttribute("position");
  const count = positions.count;
  const faceCount = count / 3;

  // 1. Compute face normals
  const faceNormals = new Float32Array(faceCount * 3);
  const v0 = new THREE.Vector3(),
    v1 = new THREE.Vector3(),
    v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3(),
    e2 = new THREE.Vector3(),
    fn = new THREE.Vector3();

  for (let f = 0; f < faceCount; f++) {
    v0.fromBufferAttribute(positions, f * 3);
    v1.fromBufferAttribute(positions, f * 3 + 1);
    v2.fromBufferAttribute(positions, f * 3 + 2);
    e1.subVectors(v1, v0);
    e2.subVectors(v2, v0);
    fn.crossVectors(e1, e2).normalize();
    faceNormals[f * 3] = fn.x;
    faceNormals[f * 3 + 1] = fn.y;
    faceNormals[f * 3 + 2] = fn.z;
  }

  // 2. Build position → face indices map
  const precision = 1e-4;
  const posToFaces = new Map<string, number[]>();
  const posKey = (x: number, y: number, z: number) =>
    `${Math.round(x / precision)},${Math.round(y / precision)},${Math.round(z / precision)}`;

  for (let f = 0; f < faceCount; f++) {
    for (let vi = 0; vi < 3; vi++) {
      const idx = f * 3 + vi;
      const key = posKey(
        positions.getX(idx),
        positions.getY(idx),
        positions.getZ(idx),
      );
      let list = posToFaces.get(key);
      if (!list) {
        list = [];
        posToFaces.set(key, list);
      }
      if (!list.includes(f)) list.push(f);
    }
  }

  // 3. For each vertex, average normals of adjacent faces within crease angle
  const cosThreshold = Math.cos(creaseAngle);
  const normals = new Float32Array(count * 3);
  const avgN = new THREE.Vector3();
  const myN = new THREE.Vector3();
  const adjN = new THREE.Vector3();

  for (let f = 0; f < faceCount; f++) {
    myN.set(faceNormals[f * 3], faceNormals[f * 3 + 1], faceNormals[f * 3 + 2]);

    for (let vi = 0; vi < 3; vi++) {
      const idx = f * 3 + vi;
      const key = posKey(
        positions.getX(idx),
        positions.getY(idx),
        positions.getZ(idx),
      );
      const adjacentFaces = posToFaces.get(key)!;

      avgN.set(0, 0, 0);
      for (const adjF of adjacentFaces) {
        adjN.set(
          faceNormals[adjF * 3],
          faceNormals[adjF * 3 + 1],
          faceNormals[adjF * 3 + 2],
        );
        if (myN.dot(adjN) >= cosThreshold) {
          avgN.add(adjN);
        }
      }
      avgN.normalize();

      normals[idx * 3] = avgN.x;
      normals[idx * 3 + 1] = avgN.y;
      normals[idx * 3 + 2] = avgN.z;
    }
  }

  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
}
