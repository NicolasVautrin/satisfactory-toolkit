import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fetchBatchGlb } from './batchGlb.js';
import { getDisplay } from './scene.js';

// ── State ──────────────────────────────────────────────────────
const loader = new GLTFLoader();
const splineGeometries = {};
// GLB is in glTF coords (Y-up, meters); viewer uses Unreal-like coords (Z-up, cm)
// glTF(x,y,z) → viewer(-x*100, z*100, y*100) — flip X, swap Y↔Z
const _glbToViewer = new THREE.Matrix4().set(
  -100,   0,    0,   0,
     0,   0,  100,   0,
     0, 100,    0,   0,
     0,   0,    0,   1,
);

const _identityQuat = new THREE.Quaternion();
const _identityMatrix = new THREE.Matrix4();

// Cache: lod → Map<className, { geometry, material, localQuat }>
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

export function getMeshLocalQuat(className) {
  const lodCache = cache.get(currentLod);
  return lodCache?.get(className)?.localQuat || null;
}

export function updateClassNames(classNames) {
  classNamesUsed = classNames;
}

export async function loadSplineSegments() {
  const types = ['spline_belt', 'spline_pipe', 'spline_track'];
  const entries = await fetchBatchGlb('catalog', types);
  // Rotate so length axis (-X after glbToViewer) aligns with Y (splineMatrix length axis)
  const rotMatrix = new THREE.Matrix4().makeRotationZ(-Math.PI / 2);
  for (const entry of entries) {
    const result = await parseGlb(entry.name, entry.glb);
    if (result) {
      result.geometry.applyMatrix4(rotMatrix);
      const key = entry.name.replace('spline_', '');
      splineGeometries[key] = result.geometry;
    }
  }
  console.log(`[Catalog] Loaded ${Object.keys(splineGeometries).length} spline segments`);
}

export function getSplineGeometry(type) {
  return splineGeometries[type] || null;
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

    // Collect mesh nodes in one traversal
    const meshNodes = [];
    let material = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((child) => {
      if (!child.isMesh) return;
      meshNodes.push(child);
      if (!material) material = child.material.clone();
    });

    if (meshNodes.length === 0) return null;

    // Check if all mesh nodes share the same rotation (quaternion dot > 0.9999)
    const firstQuat = meshNodes[0].quaternion;
    let allSameRot = true;
    for (let i = 1; i < meshNodes.length; i++) {
      if (Math.abs(firstQuat.dot(meshNodes[i].quaternion)) < 0.9999) {
        allSameRot = false;
        break;
      }
    }
    const hasRotation = allSameRot &&
      (Math.abs(firstQuat.x) > 0.0001 || Math.abs(firstQuat.y) > 0.0001 ||
       Math.abs(firstQuat.z) > 0.0001 || Math.abs(firstQuat.w - 1) > 0.0001);

    let localQuat = null;
    const geometries = [];
    const _pos = new THREE.Vector3();
    const _rot = new THREE.Quaternion();
    const _scl = new THREE.Vector3();

    if (allSameRot && hasRotation) {
      // Extract common rotation R; bake position+scale with R⁻¹ applied to position
      // so that: R * (S * v + R⁻¹ * t) = R * S * v + t  (correct result)
      const invQuat = firstQuat.clone().invert();
      for (const node of meshNodes) {
        const geom = node.geometry.clone();
        node.matrixWorld.decompose(_pos, _rot, _scl);
        _pos.applyQuaternion(invQuat);
        geom.applyMatrix4(new THREE.Matrix4().compose(_pos, _identityQuat, _scl));
        geometries.push(geom);
      }
      localQuat = firstQuat.clone();
    } else {
      // Bake full matrixWorld (identity rotation or mixed rotations)
      for (const node of meshNodes) {
        const geom = node.geometry.clone();
        if (!node.matrixWorld.equals(_identityMatrix)) {
          geom.applyMatrix4(node.matrixWorld);
        }
        geometries.push(geom);
      }
    }

    const merged = geometries.length === 1
      ? geometries[0]
      : mergeGeometries(geometries, false);

    if (!merged) return null;

    merged.applyMatrix4(_glbToViewer);

    // BackSide: _glbToViewer has det=-1 (X-reflection) which reverses winding.
    // Instead of swapping triangle indices, render back faces — Three.js shader
    // auto-flips normals via gl_FrontFacing for correct lighting.
    material.side = THREE.BackSide;

    merged.computeVertexNormals();
    merged.computeBoundingBox();

    return { geometry: merged, material, localQuat };
  } catch (err) {
    console.warn(`[Catalog] Failed to parse ${className}.glb:`, err.message);
    return null;
  }
}
