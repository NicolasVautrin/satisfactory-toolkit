import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera, requestRender } from './scene.js';
import { fetchBatchGlb } from './batchGlb.js';

// ── Constants ──────────────────────────────────────────────
const LANDSCAPE_SCALE = 10000;
const TILE_UNIT = 12700;              // UE units per tile
const TILE_PROXY_OFFSET = 4 * 12700;  // 50800

const BATCH_SIZE = 50;
const MOVE_THRESHOLD = 6000;          // UE units before re-evaluating

// ── State ──────────────────────────────────────────────────
const gltfLoader = new GLTFLoader();
const tileIndex = new Map();          // "col,row" → TileDescriptor
let basePlane = null;
let landscapeMap = null;              // THREE.Texture (assembled JPEG)
let landscapeMaterial = null;         // MeshLambertMaterial shared by all tiles
let landscapeBounds = null;           // { minX, maxX, minY, maxY } in viewer space
let landscapeVisible = true;
let streamingEnabled = false;         // set by layoutLoaded()
let batchInFlight = false;
let lastCamX = Infinity, lastCamY = Infinity;

const loadedMeshes = [];              // all loaded tile meshes (for visibility toggle)

// ── Exports ────────────────────────────────────────────────
export function getLandscapeBounds() { return landscapeBounds; }
export function getLandscapeMap() { return landscapeMap; }
export function getLoadedLandscapeMeshes() { return loadedMeshes; }

export function setLandscapeVisible(visible) {
  landscapeVisible = visible;
  if (basePlane) basePlane.visible = visible;
  for (const m of loadedMeshes) m.visible = visible;
  requestRender();
}

export function layoutLoaded() {
  streamingEnabled = true;
  // Force first streaming pass
  lastCamX = Infinity;
  lastCamY = Infinity;
}

// ── Build landscape (base plane + metadata) ────────────────
export async function buildLandscape() {
  // Clean previous
  if (basePlane) {
    scene.remove(basePlane);
    basePlane.geometry.dispose();
    basePlane.material.dispose();
    if (landscapeMap) landscapeMap.dispose();
    basePlane = null;
    landscapeMap = null;
  }
  for (const m of loadedMeshes) {
    scene.remove(m);
    m.geometry.dispose();
  }
  loadedMeshes.length = 0;
  tileIndex.clear();
  landscapeBounds = null;
  landscapeMaterial = null;
  streamingEnabled = false;
  batchInFlight = false;

  // 1. Fetch tile metadata
  const res = await fetch('/api/viewer/landscape-data');
  const { tiles } = await res.json();
  if (!tiles || tiles.length === 0) {
    console.warn('[Landscape] No tiles available');
    return;
  }

  // Build tile index + compute global bounds
  let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
  for (const tile of tiles) {
    const col = tile.x;
    const row = tile.y;
    // tile.glb is "glb/comp_X_Y.glb" — extract the name without prefix/extension
    const glbName = tile.glb.replace(/^glb\//, '').replace(/\.glb$/, '');
    tileIndex.set(`${col},${row}`, {
      glbName,
      worldMinX: tile.worldMinX, worldMinY: tile.worldMinY,
      worldMaxX: tile.worldMaxX, worldMaxY: tile.worldMaxY,
      state: 'unloaded',
      mesh: null,
    });
    if (tile.worldMinX !== undefined) {
      gMinX = Math.min(gMinX, tile.worldMinX);
      gMaxX = Math.max(gMaxX, tile.worldMaxX);
      gMinY = Math.min(gMinY, tile.worldMinY);
      gMaxY = Math.max(gMaxY, tile.worldMaxY);
    }
  }

  // UE bounds with proxy offset (for viewer positioning)
  const ueMinX = gMinX - TILE_PROXY_OFFSET;
  const ueMaxX = gMaxX - TILE_PROXY_OFFSET;
  const ueMinY = gMinY - TILE_PROXY_OFFSET;
  const ueMaxY = gMaxY - TILE_PROXY_OFFSET;

  landscapeBounds = {
    minX: -ueMaxX, maxX: -ueMinX,
    minY: ueMinY, maxY: ueMaxY,
  };

  console.log(`[Landscape] ${tiles.length} tiles indexed, UE X[${ueMinX}, ${ueMaxX}] Y[${ueMinY}, ${ueMaxY}]`);

  // 2. Fetch assembled map image and flip to viewer-space
  try {
    const img = await loadImage('/api/viewer/landscape-map');
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.translate(img.width, img.height);
    ctx.scale(-1, -1); // flip X (viewer X = -ueX) + flip Y (viewer Y-up vs canvas Y-down)
    ctx.drawImage(img, 0, 0);
    landscapeMap = new THREE.Texture(canvas);
    landscapeMap.needsUpdate = true;
    landscapeMap.colorSpace = THREE.SRGBColorSpace;
    landscapeMap.minFilter = THREE.LinearMipmapLinearFilter;
    landscapeMap.magFilter = THREE.LinearFilter;
  } catch (err) {
    console.warn('[Landscape] Could not load assembled map:', err.message);
    return;
  }

  // 3. Create shared material for tiles
  landscapeMaterial = new THREE.MeshLambertMaterial({
    map: landscapeMap,
    side: THREE.DoubleSide,
  });

  // 4. Create base plane with UVs mapped from viewer-space to UE image coords
  const width = landscapeBounds.maxX - landscapeBounds.minX;
  const height = landscapeBounds.maxY - landscapeBounds.minY;
  const planeGeom = new THREE.PlaneGeometry(width, height);
  const uvAttr = planeGeom.getAttribute('uv');
  const posAttr = planeGeom.getAttribute('position');
  const cx = (landscapeBounds.minX + landscapeBounds.maxX) / 2;
  const cy = (landscapeBounds.minY + landscapeBounds.maxY) / 2;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i) + cx;
    const vy = posAttr.getY(i) + cy;
    const u = (vx - landscapeBounds.minX) / (landscapeBounds.maxX - landscapeBounds.minX);
    const v = (vy - landscapeBounds.minY) / (landscapeBounds.maxY - landscapeBounds.minY);
    uvAttr.setXY(i, u, v);
  }
  uvAttr.needsUpdate = true;

  const planeMat = new THREE.MeshBasicMaterial({
    map: landscapeMap,
    side: THREE.DoubleSide,
  });
  basePlane = new THREE.Mesh(planeGeom, planeMat);
  basePlane.renderOrder = -3;
  basePlane.position.set(cx, cy, -10);
  basePlane.visible = landscapeVisible;
  scene.add(basePlane);

  console.log(`[Landscape] Base plane created (${width.toFixed(0)} x ${height.toFixed(0)})`);
  requestRender();
}

// ── Streaming update ───────────────────────────────────────
export function updateStreaming() {
  if (!streamingEnabled || tileIndex.size === 0 || batchInFlight) return;

  // Camera position → UE coords
  const camUeX = -camera.position.x;
  const camUeY = camera.position.y;

  // Track camera movement
  const dx = camUeX - lastCamX;
  const dy = camUeY - lastCamY;
  if (dx * dx + dy * dy >= MOVE_THRESHOLD * MOVE_THRESHOLD) {
    lastCamX = camUeX;
    lastCamY = camUeY;
  }

  // Collect closest unloaded tiles
  const candidates = [];
  for (const [, tile] of tileIndex) {
    if (tile.state !== 'unloaded') continue;
    const tileCx = (tile.worldMinX + tile.worldMaxX) / 2 - TILE_PROXY_OFFSET;
    const tileCy = (tile.worldMinY + tile.worldMaxY) / 2 - TILE_PROXY_OFFSET;
    const distSq = (tileCx - lastCamX) ** 2 + (tileCy - lastCamY) ** 2;
    candidates.push({ tile, distSq });
  }

  if (candidates.length === 0) return;

  candidates.sort((a, b) => a.distSq - b.distSq);
  const batch = candidates.slice(0, BATCH_SIZE);

  // Mark as requested
  const fileNames = [];
  const batchTiles = [];
  for (const { tile } of batch) {
    tile.state = 'requested';
    fileNames.push(tile.glbName);
    batchTiles.push(tile);
  }

  // Build lookup: glbName → tile
  const tileByName = new Map();
  for (const { tile } of batch) {
    tileByName.set(tile.glbName, tile);
  }

  batchInFlight = true;
  loadBatchAsync(fileNames, tileByName).finally(() => {
    batchInFlight = false;
  });
}

// ── Load a batch of tiles ─────────────────────────────────
async function loadBatchAsync(fileNames, tileByName) {
  try {
    const entries = await fetchBatchGlb('landscape/glb', fileNames, 'low');

    for (const { name, glb } of entries) {
      const tile = tileByName.get(name);
      if (!tile) continue;
      try {
        await processTileGlb(tile, glb);
      } catch (err) {
        console.warn(`[Landscape] Failed to process ${name}:`, err.message);
        tile.state = 'unloaded';
      }
    }

    // Mark tiles not returned by server as unloaded
    for (const [name, tile] of tileByName) {
      if (tile.state === 'requested') tile.state = 'unloaded';
    }

    requestRender();
  } catch (err) {
    console.warn('[Landscape] Batch fetch failed:', err.message);
    for (const [, tile] of tileByName) {
      if (tile.state === 'requested') tile.state = 'unloaded';
    }
  }
}

// ── Process a single tile GLB buffer ──────────────────────
async function processTileGlb(tile, buffer) {
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

  if (geometries.length === 0) { tile.state = 'unloaded'; return; }

  const merged = geometries.length === 1
    ? geometries[0]
    : mergeGeometries(geometries, false);
  if (!merged) { tile.state = 'unloaded'; return; }

  // Transform: glTF coords → viewer coords
  merged.computeBoundingBox();
  const bb = merged.boundingBox;
  const shiftX = -bb.min.x;
  const shiftZ = -bb.min.z;
  const S = LANDSCAPE_SCALE;

  const tileMat = new THREE.Matrix4().set(
    -S,  0,  0, -S * shiftX,
     0,  0,  S,  S * shiftZ,
     0,  S,  0,  0,
     0,  0,  0,  1,
  );
  merged.applyMatrix4(tileMat);

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

  // Compute mesh world position
  let meshPosX = 0, meshPosY = 0;
  if (tile.worldMinX !== undefined) {
    const ueX = tile.worldMinX - TILE_PROXY_OFFSET;
    const ueY = tile.worldMinY - TILE_PROXY_OFFSET;
    meshPosX = -ueX;
    meshPosY = ueY;
  }

  // Generate UVs from world position
  generateWorldUVs(merged, meshPosX, meshPosY);

  const mesh = new THREE.Mesh(merged, landscapeMaterial);
  mesh.renderOrder = -2;
  mesh.visible = landscapeVisible;
  mesh.position.set(meshPosX, meshPosY, 0);

  scene.add(mesh);
  tile.mesh = mesh;
  tile.state = 'loaded';
  loadedMeshes.push(mesh);
}

// ── Generate UVs from viewer-space world position ───────────
function generateWorldUVs(geometry, meshPosX, meshPosY) {
  const pos = geometry.getAttribute('position');
  if (!pos) return;

  const b = landscapeBounds;
  const rangeX = b.maxX - b.minX || 1;
  const rangeY = b.maxY - b.minY || 1;
  const uvs = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i) + meshPosX;
    const vy = pos.getY(i) + meshPosY;
    uvs[i * 2]     = (vx - b.minX) / rangeX;
    uvs[i * 2 + 1] = (vy - b.minY) / rangeY;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

// ── Helper: load image as promise ──────────────────────────
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}
