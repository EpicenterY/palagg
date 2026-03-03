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
