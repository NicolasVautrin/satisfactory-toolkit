import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fetchBatchGlb } from './batchGlb.js';
import { getDisplay } from './scene.js';

// ── State ──────────────────────────────────────────────────────
const loader = new GLTFLoader();
// GLB is in glTF coords (Y-up, meters); viewer uses Unreal-like coords (Z-up, cm)
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
  const d = getDisplay();
  return d !== 'boxes' ? d : 'lod0';
})();
const availableLods = ['lod0', 'lod1', 'lod2', 'lod3', 'lod4', 'lod5'];
let classNamesUsed = [];

// ── Public API ─────────────────────────────────────────────────

export function getAvailableLods() {
  return availableLods;
}

export function getCurrentLod() { return currentLod; }

export async function initMeshCatalog(classNames) {
  classNamesUsed = classNames;
  await loadLod(currentLod, classNames);
}

export async function setLod(lod) {
  if (!cache.has(lod)) {
    currentLod = lod;
    await loadLod(lod, classNamesUsed);
    return true;
  }
  // Cache exists — check for missing classes
  const lodCache = cache.get(lod);
  const missing = classNamesUsed.filter(cn => !lodCache.has(cn));
  if (lod === currentLod && missing.length === 0) return false;
  currentLod = lod;
  if (missing.length > 0) await loadMissing(lod, missing);
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

export function updateClassNames(classNames) {
  classNamesUsed = classNames;
}

export async function loadMissingMeshes() {
  if (!cache.has(currentLod) || classNamesUsed.length === 0) return false;
  const lodCache = cache.get(currentLod);
  const missing = classNamesUsed.filter(cn => !lodCache.has(cn));
  if (missing.length === 0) return false;
  await loadMissing(currentLod, missing);
  return true;
}

export function hasMeshesAvailable() {
  const lodCache = cache.get(currentLod);
  return lodCache ? lodCache.size > 0 : false;
}

// ── Internal ───────────────────────────────────────────────────

async function loadMissing(lod, classNames) {
  const entries = await fetchBatchGlb(`catalog/${lod}`, classNames);
  const lodCache = cache.get(lod);
  const results = await Promise.allSettled(
    entries.map(entry => parseGlb(entry.name, entry.glb))
  );
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value) {
      lodCache.set(entries[i].name, results[i].value);
    }
  }
  console.log(`[Catalog] ${lod}: loaded ${results.filter(r => r.status === 'fulfilled' && r.value).length} missing meshes`);
}

async function loadLod(lod, classNames) {
  if (classNames.length === 0) return;

  // Fetch all classNames via batch GLB — server returns only those that exist
  const entries = await fetchBatchGlb(`catalog/${lod}`, classNames);

  const lodCache = new Map();
  cache.set(lod, lodCache);

  const results = await Promise.allSettled(
    entries.map(entry => parseGlb(entry.name, entry.glb))
  );

  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'fulfilled' && results[i].value) {
      lodCache.set(entries[i].name, results[i].value);
    }
  }

  console.log(`[Catalog] ${lod}: loaded ${lodCache.size}/${classNames.length} meshes (${classNames.length - lodCache.size} fallback to boxes)`);
}

async function parseGlb(className, glbBuffer) {
  try {
    const blob = new Blob([glbBuffer], { type: 'model/gltf-binary' });
    const url = URL.createObjectURL(blob);
    const gltf = await loader.loadAsync(url);
    URL.revokeObjectURL(url);

    const geometries = [];
    let material = null;

    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((child) => {
      if (!child.isMesh) return;
      const geom = child.geometry.clone();
      if (!child.matrixWorld.equals(new THREE.Matrix4())) {
        geom.applyMatrix4(child.matrixWorld);
      }
      geometries.push(geom);
      if (!material) {
        material = child.material.clone();
      }
    });

    if (geometries.length === 0) return null;

    const merged = geometries.length === 1
      ? geometries[0]
      : mergeGeometries(geometries, false);

    if (!merged) return null;

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
    merged.computeBoundingBox();

    return { geometry: merged, material };
  } catch (err) {
    console.warn(`[Catalog] Failed to parse ${className}.glb:`, err.message);
    return null;
  }
}
