import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, gameToViewer, gameToViewerQuat, requestRender } from './scene.js';
import { getUELandscapeBounds } from './landscape.js';
import { fetchBatchGlb } from './batchGlb.js';

// ── GLB to viewer transform (same as scenery/catalog) ──────
const _glbToViewer = new THREE.Matrix4().set(
  -100,   0,    0,   0,
     0,   0,  100,   0,
     0, 100,    0,   0,
     0,   0,    0,   1,
);

// ── State ──────────────────────────────────────────────────
const gltfLoader = new GLTFLoader();
const waterGroup = new THREE.Group();
waterGroup.name = 'water';
scene.add(waterGroup);

let waterVisible = true;
let loaded = false;
window._waterGroup = waterGroup;

// ── Public API ─────────────────────────────────────────────
export function setWaterVisible(visible) {
  waterVisible = visible;
  waterGroup.visible = visible;
  for (const child of waterGroup.children) child.visible = visible;
  requestRender();
}

export function isWaterLoaded() { return loaded; }

// ── Build water ────────────────────────────────────────────
export async function buildWater() {
  // Clean previous
  while (waterGroup.children.length) {
    const child = waterGroup.children[0];
    waterGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  }
  loaded = false;

  const res = await fetch('/api/viewer/layout?type=water');
  const { placements, rivers, meshes } = await res.json();
  if ((!placements || placements.length === 0) && (!rivers || rivers.length === 0)) {
    console.warn('[Water] No placements or rivers');
    return;
  }

  // Filter: keep only instances whose center is inside the map
  const ue = getUELandscapeBounds();
  const filtered = ue
    ? placements.filter(p =>
        p.x >= ue.minX && p.x <= ue.maxX &&
        p.y >= ue.minY && p.y <= ue.maxY)
    : placements;

  if (filtered.length < placements.length) {
    console.log(`[Water] Filtered ${placements.length - filtered.length} out-of-bounds placements`);
  }

  // Group placements by mesh name
  const byMesh = {};
  for (const p of filtered) {
    (byMesh[p.mesh] ??= []).push(p);
  }

  // Load GLBs
  const meshNames = Object.keys(byMesh).filter(n => meshes.includes(n));
  const geometryCache = new Map();

  if (meshNames.length > 0) {
    const entries = await fetchBatchGlb('water/glb', meshNames);
    for (const { name, glb } of entries) {
      const geom = await parseWaterGeometry(glb);
      if (geom) geometryCache.set(name, geom);
    }
  }

  // Fallback: simple plane for meshes not loaded
  const fallbackGeom = new THREE.PlaneGeometry(100, 100);
  fallbackGeom.rotateX(-Math.PI / 2); // XZ plane

  const waterMat = new THREE.MeshLambertMaterial({
    color: 0x2266cc,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide,
    depthWrite: true,
    stencilWrite: true,
    stencilFunc: THREE.EqualStencilFunc,
    stencilRef: 0,
    stencilZPass: THREE.IncrementStencilOp,
  });

  let totalInstances = 0;

  for (const [meshName, actors] of Object.entries(byMesh)) {
    const geom = geometryCache.get(meshName) || fallbackGeom;
    const instanced = new THREE.InstancedMesh(geom, waterMat, actors.length);
    instanced.name = `water_${meshName}`;
    instanced.renderOrder = -2;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      dummy.position.copy(gameToViewer(a.x, a.y, a.z));
      dummy.quaternion.copy(gameToViewerQuat(a.qx || 0, a.qy || 0, a.qz || 0, a.qw || 1));
      dummy.scale.set(a.sx || 1, a.sy || 1, a.sz || 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    instanced.visible = waterVisible;
    waterGroup.add(instanced);
    totalInstances += actors.length;
  }

  // ── Rivers (ribbon meshes from spline data) ──────────────
  let riverCount = 0;
  if (rivers && rivers.length > 0) {
    for (const river of rivers) {
      // Filter: skip rivers whose center is outside the map
      if (ue && river.points.length > 0) {
        const mid = river.points[Math.floor(river.points.length / 2)];
        if (mid.x < ue.minX || mid.x > ue.maxX || mid.y < ue.minY || mid.y > ue.maxY) continue;
      }
      const ribbon = buildRiverRibbon(river.points, waterMat);
      if (!ribbon) continue;
      ribbon.name = `water_river_${riverCount}`;
      ribbon.renderOrder = -1;
      ribbon.visible = waterVisible;
      waterGroup.add(ribbon);
      riverCount++;
    }
  }

  loaded = true;
  console.log(`[Water] ${totalInstances} water planes (${Object.keys(byMesh).length} mesh types), ${riverCount} rivers`);
  requestRender();
}

// ── River ribbon mesh from hermite spline ──────────────────
function buildRiverRibbon(points, mat) {
  if (!points || points.length < 2) return null;

  // Sample hermite spline with per-point half-width interpolation
  const sampled = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i], p1 = points[i + 1];
    const w0 = p0.w || 500, w1 = p1.w || 500; // half-width per control point
    const steps = 8;
    for (let s = 0; s <= steps; s++) {
      if (s === 0 && i > 0) continue;
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      const h00 = 2*t3 - 3*t2 + 1, h10 = t3 - 2*t2 + t;
      const h01 = -2*t3 + 3*t2,     h11 = t3 - t2;
      sampled.push({
        x: h00*p0.x + h10*p0.lx + h01*p1.x + h11*p1.ax,
        y: h00*p0.y + h10*p0.ly + h01*p1.y + h11*p1.ay,
        z: h00*p0.z + h10*p0.lz + h01*p1.z + h11*p1.az,
        w: w0 + (w1 - w0) * t, // linearly interpolate half-width
      });
    }
  }

  if (sampled.length < 2) return null;

  const verts = [];
  const indices = [];

  for (let i = 0; i < sampled.length; i++) {
    // Tangent direction
    let tx, ty;
    if (i < sampled.length - 1) {
      tx = sampled[i + 1].x - sampled[i].x;
      ty = sampled[i + 1].y - sampled[i].y;
    } else {
      tx = sampled[i].x - sampled[i - 1].x;
      ty = sampled[i].y - sampled[i - 1].y;
    }
    // Perpendicular in UE XZ plane (horizontal)
    const halfW = sampled[i].w;
    const len = Math.sqrt(tx * tx + ty * ty) || 1;
    const nx = -ty / len * halfW;
    const ny = tx / len * halfW;

    // UE (x,y,z) → viewer (-x, y, z) via gameToViewer
    const p = sampled[i];
    verts.push(-p.x - nx, p.y + ny, p.z); // left
    verts.push(-p.x + nx, p.y - ny, p.z); // right
  }

  for (let i = 0; i < sampled.length - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    indices.push(a, c, b, b, c, d);
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mesh = new THREE.Mesh(geom, mat);
  return mesh;
}

// ── Parse GLB → geometry ───────────────────────────────────
async function parseWaterGeometry(buffer) {
  try {
    const gltf = await new Promise((resolve, reject) => {
      gltfLoader.parse(buffer, '', resolve, reject);
    });

    const geometries = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(child => {
      if (!child.isMesh) return;
      const geom = child.geometry.clone();
      if (!child.matrixWorld.equals(new THREE.Matrix4())) {
        geom.applyMatrix4(child.matrixWorld);
      }
      geometries.push(geom);
    });

    if (geometries.length === 0) return null;

    const merged = geometries.length === 1
      ? geometries[0]
      : mergeGeometries(geometries, false);
    if (!merged) return null;

    // Transform glTF → viewer coords
    merged.applyMatrix4(_glbToViewer);

    // Fix face winding after X flip
    const index = merged.getIndex();
    if (index) {
      const arr = index.array;
      for (let i = 0; i < arr.length; i += 3) {
        const tmp = arr[i];
        arr[i] = arr[i + 2];
        arr[i + 2] = tmp;
      }
      index.needsUpdate = true;
    }
    merged.computeVertexNormals();
    return merged;
  } catch {
    return null;
  }
}
