import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, requestRender } from './scene.js';

// ── Terrain-specific transform ──────────────────────────
const TERRAIN_SCALE = 10000;
const _terrainToViewer = new THREE.Matrix4().set(
  -TERRAIN_SCALE,             0,              0,   0,
               0,             0,  TERRAIN_SCALE,   0,
               0, TERRAIN_SCALE,              0,   0,
               0,             0,              0,   1,
);

const TILE_SIZE = 50800;
// Offset applied to UE tile worldMin coords — compensates for proxy actor origin shift in UE levels
const TILE_PROXY_OFFSET = 4 * 12700; // 50800

// ── State ───────────────────────────────────────────────
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const terrainMeshes = [];
let terrainVisible = true;

export function setTerrainVisible(visible) {
  terrainVisible = visible;
  for (const m of terrainMeshes) m.visible = visible;
  requestRender();
}

// ── Load and build terrain from GLB tiles ───────────────
export async function buildTerrain() {
  for (const m of terrainMeshes) {
    scene.remove(m);
    m.geometry.dispose();
    if (m.material.map) m.material.map.dispose();
    m.material.dispose();
  }
  terrainMeshes.length = 0;

  const res = await fetch('/api/terrain-tiles');
  const { tiles } = await res.json();
  if (!tiles || tiles.length === 0) {
    console.warn('[Terrain] No tiles available');
    return;
  }

  console.log(`[Terrain] Loading ${tiles.length} tiles...`);

  // Load in batches to avoid ERR_INSUFFICIENT_RESOURCES
  const BATCH = 50;
  let loaded = 0;
  for (let i = 0; i < tiles.length; i += BATCH) {
    const batch = tiles.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(tile => loadTile(tile)));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) loaded++;
    }
    requestRender();
  }

  console.log(`[Terrain] ${loaded}/${tiles.length} tiles loaded`);
  // Debug: expose + log first tile info
  if (terrainMeshes.length > 0) {
    const m = terrainMeshes[0];
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    console.log(`[Terrain] First tile: pos(${m.position.x.toFixed(0)},${m.position.y.toFixed(0)},${m.position.z.toFixed(0)}) bbox min(${bb.min.x.toFixed(0)},${bb.min.y.toFixed(0)},${bb.min.z.toFixed(0)}) max(${bb.max.x.toFixed(0)},${bb.max.y.toFixed(0)},${bb.max.z.toFixed(0)}) visible=${m.visible} inScene=${m.parent?.type}`);
  }
  window._terrainMeshes = terrainMeshes;
  requestRender();
}

async function loadTile(tile) {
  try {
    const gltf = await gltfLoader.loadAsync(`/meshes/terrain/${tile.glb}`);

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

    // Generate UVs from vertex positions BEFORE transform (glTF local coords)
    // Tile vertices span roughly 0..5.08 in X and Z (glTF space)
    generateUVs(merged);

    // glTF coords: X,Z = horizontal (meters, may have world offset), Y = height
    // We need to shift geometry to tile-local origin before scaling
    merged.computeBoundingBox();
    const bb = merged.boundingBox;

    // Shift to origin: subtract glTF min X and min Z so geometry starts at (0,0)
    const shiftX = -bb.min.x;
    const shiftZ = -bb.min.z;
    const S = TERRAIN_SCALE;

    // Combined: shift to origin, scale, convert axes: glTF(x,y,z) → viewer(-S*(x+shiftX), S*(z+shiftZ), S*y)
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

    // Try loading the baked texture PNG
    let material;
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = `/meshes/terrain/${tile.img}`;
      });
      const texture = new THREE.Texture(image);
      texture.needsUpdate = true;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      material = new THREE.MeshLambertMaterial({
        map: texture,
        side: THREE.DoubleSide,
      });
    } catch {
      // No PNG texture, fallback to flat green
      material = new THREE.MeshLambertMaterial({
        color: 0x5a7d3a,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      });
    }

    const mesh = new THREE.Mesh(merged, material);
    mesh.renderOrder = -2;
    mesh.visible = terrainVisible;
    if (tile.worldMinX !== undefined) {
      const ueX = tile.worldMinX - TILE_PROXY_OFFSET;
      const ueY = tile.worldMinY - TILE_PROXY_OFFSET;
      mesh.position.set(-ueX, ueY, 0);
    }

    scene.add(mesh);
    terrainMeshes.push(mesh);

    return mesh;
  } catch (err) {
    console.warn(`[Terrain] Failed to load ${tile.file}:`, err.message);
    return null;
  }
}

function generateUVs(geometry) {
  const pos = geometry.getAttribute('position');
  if (!pos) return;

  // Compute bounds in glTF XZ plane (horizontal)
  let minX = Infinity, maxX = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  const rangeX = maxX - minX || 1;
  const rangeZ = maxZ - minZ || 1;
  const uvs = new Float32Array(pos.count * 2);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    // U = X normalized, V = 1 - Z normalized (PNG Y is top-down)
    uvs[i * 2]     = (x - minX) / rangeX;
    uvs[i * 2 + 1] = 1.0 - (z - minZ) / rangeZ;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}
