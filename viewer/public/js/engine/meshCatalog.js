import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ── State ──────────────────────────────────────────────────────
const loader = new GLTFLoader();
// GLB is in glTF coords (Y-up, meters); viewer uses Unreal-like coords (Z-up, cm)
// Transform: scale m→cm, flip X (gameToViewer), rotate Y-up → Z-up
// glTF(x,y,z) → viewer(-x*100, z*100, y*100) — flip X, swap Y↔Z
const _glbToViewer = new THREE.Matrix4().set(
  -100,   0,    0,   0,
     0,   0,  100,   0,
     0, 100,    0,   0,
     0,   0,    0,   1,
);

// Cache: lod → Map<className, { geometry, material }>
const cache = new Map();
let currentLod = (() => {
  const d = typeof localStorage !== 'undefined' && localStorage.getItem('viewer_display');
  return (d && d !== 'boxes') ? d : 'lod2';
})();
let availableLods = null;
let classNamesUsed = [];

// ── Public API ─────────────────────────────────────────────────

export async function getAvailableLods() {
  if (availableLods) return availableLods;
  const res = await fetch('/api/mesh-lods');
  const data = await res.json();
  availableLods = data.lods;
  return availableLods;
}

export function getCurrentLod() { return currentLod; }

export async function initMeshCatalog(classNames) {
  classNamesUsed = classNames;
  await loadLod(currentLod, classNames);
}

export async function setLod(lod) {
  if (lod === currentLod && cache.has(lod)) return false;
  currentLod = lod;
  if (!cache.has(lod)) {
    await loadLod(lod, classNamesUsed);
  }
  return true;
}

export function getMeshGeometry(className) {
  const lodCache = cache.get(currentLod);
  return lodCache?.get(className)?.geometry || null;
}

export function getMeshMaterial(className) {
  const lodCache = cache.get(currentLod);
  return lodCache?.get(className)?.material || null;
}

export function hasMeshesAvailable() {
  const lodCache = cache.get(currentLod);
  return lodCache ? lodCache.size > 0 : false;
}

// ── Internal ───────────────────────────────────────────────────

async function loadLod(lod, classNames) {
  const res = await fetch(`/api/mesh-catalog?lod=${lod}`);
  const data = await res.json();

  // Only load meshes for classNames actually used in the save
  const classSet = new Set(classNames);
  const toLoad = data.meshes.filter(m => classSet.has(m));

  if (toLoad.length === 0) return;

  const lodCache = new Map();
  cache.set(lod, lodCache);

  const results = await Promise.allSettled(
    toLoad.map(className => loadGlb(lod, className))
  );

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value) {
      lodCache.set(toLoad[i], results[i].value);
    }
  }

  console.log(`[MeshCatalog] ${lod}: loaded ${lodCache.size}/${toLoad.length} meshes`);
}

async function loadGlb(lod, className) {
  try {
    const gltf = await loader.loadAsync(`/meshes/${lod}/${className}.glb`);

    const geometries = [];
    let material = null;

    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((child) => {
      if (!child.isMesh) return;
      const geom = child.geometry.clone();
      // Apply any transform the child has within the GLB scene graph
      if (!child.matrixWorld.equals(new THREE.Matrix4())) {
        console.log(`[MeshCatalog] ${className}/${child.name}: matrixWorld`, child.matrixWorld.elements.map(v => +v.toFixed(4)));
        geom.applyMatrix4(child.matrixWorld);
      }
      geometries.push(geom);
      // Keep first material found
      if (!material) {
        material = child.material.clone();
      }
    });

    if (geometries.length === 0) return null;

    const merged = geometries.length === 1
      ? geometries[0]
      : mergeGeometries(geometries, false);

    if (!merged) return null;

    // Transform glTF (Y-up, meters) → viewer (Z-up, cm, X-flipped)
    merged.applyMatrix4(_glbToViewer);

    // Fix face winding after X flip (invert index order)
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

    // Ensure normals are correct after flip
    merged.computeVertexNormals();

    // Debug: log bounding box of loaded mesh
    merged.computeBoundingBox();
    const bb = merged.boundingBox;
    const size = { x: bb.max.x - bb.min.x, y: bb.max.y - bb.min.y, z: bb.max.z - bb.min.z };
    console.log(`[MeshCatalog] ${className}: bbox size ${size.x.toFixed(0)}x${size.y.toFixed(0)}x${size.z.toFixed(0)}, center ${((bb.min.x+bb.max.x)/2).toFixed(0)},${((bb.min.y+bb.max.y)/2).toFixed(0)},${((bb.min.z+bb.max.z)/2).toFixed(0)}`);

    return { geometry: merged, material };
  } catch (err) {
    console.warn(`[MeshCatalog] Failed to load ${lod}/${className}.glb:`, err.message);
    return null;
  }
}
