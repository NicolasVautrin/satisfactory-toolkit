import * as THREE from 'three';
import { scene, gameToViewer, requestRender } from './scene.js';

// ── Topo color stops ────────────────────────────────────────
const TOPO_STOPS = [
  { z: -5000,  r: 0.176, g: 0.314, b: 0.086 },
  { z: -1700,  r: 0.290, g: 0.478, b: 0.157 },
  { z:  1900,  r: 0.478, g: 0.647, b: 0.235 },
  { z:  9000,  r: 0.722, g: 0.788, b: 0.353 },
  { z: 14000,  r: 0.831, g: 0.753, b: 0.478 },
  { z: 20000,  r: 0.910, g: 0.855, b: 0.627 },
  { z: 30000,  r: 0.961, g: 0.929, b: 0.816 },
];
const SHALLOW_WATER_TOPO = { r: 0.165, g: 0.478, b: 0.710 };
const DEEP_WATER_TOPO    = { r: 0.082, g: 0.282, b: 0.455 };
const OFFMAP_TOPO        = { r: 0.067, g: 0.067, b: 0.067 };

function topoColor(z, out) {
  if (z === null) { out.r = OFFMAP_TOPO.r; out.g = OFFMAP_TOPO.g; out.b = OFFMAP_TOPO.b; return; }
  const stops = TOPO_STOPS;
  if (z <= stops[0].z) { out.r = stops[0].r; out.g = stops[0].g; out.b = stops[0].b; return; }
  if (z >= stops[stops.length - 1].z) { const s = stops[stops.length - 1]; out.r = s.r; out.g = s.g; out.b = s.b; return; }
  for (let i = 0; i < stops.length - 1; i++) {
    if (z >= stops[i].z && z < stops[i + 1].z) {
      const t = (z - stops[i].z) / (stops[i + 1].z - stops[i].z);
      out.r = stops[i].r + t * (stops[i + 1].r - stops[i].r);
      out.g = stops[i].g + t * (stops[i + 1].g - stops[i].g);
      out.b = stops[i].b + t * (stops[i + 1].b - stops[i].b);
      return;
    }
  }
}

// ── State ───────────────────────────────────────────────────
let terrainMesh = null;

export function setTerrainVisible(visible) {
  if (terrainMesh) terrainMesh.visible = visible;
  requestRender();
}

// ── Build terrain mesh ──────────────────────────────────────
export function buildTerrain(terrain) {
  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh.material.dispose(); }

  const { gridSize, bounds, shallowWaterZ, deepWaterZ, data } = terrain;
  const GS = gridSize;

  const vertCount = GS * GS;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const col = { r: 0, g: 0, b: 0 };

  for (let row = 0; row < GS; row++) {
    for (let col_ = 0; col_ < GS; col_++) {
      const vi = row * GS + col_;
      const gameX = bounds.xMin + (col_ / (GS - 1)) * (bounds.xMax - bounds.xMin);
      const gameY = bounds.yMin + (row / (GS - 1)) * (bounds.yMax - bounds.yMin);
      const gi = row * GS + col_;
      const z = data[gi];
      const v = gameToViewer(gameX, gameY, (z === null) ? deepWaterZ : z);

      positions[vi * 3]     = v.x;
      positions[vi * 3 + 1] = v.y;
      positions[vi * 3 + 2] = v.z;

      if (z === deepWaterZ) {
        col.r = DEEP_WATER_TOPO.r; col.g = DEEP_WATER_TOPO.g; col.b = DEEP_WATER_TOPO.b;
      } else if (z === shallowWaterZ) {
        col.r = SHALLOW_WATER_TOPO.r; col.g = SHALLOW_WATER_TOPO.g; col.b = SHALLOW_WATER_TOPO.b;
      } else {
        topoColor(z, col);
      }
      colors[vi * 3]     = col.r;
      colors[vi * 3 + 1] = col.g;
      colors[vi * 3 + 2] = col.b;
    }
  }

  const indices = [];
  for (let row = 0; row < GS - 1; row++) {
    for (let col_ = 0; col_ < GS - 1; col_++) {
      const a = row * GS + col_;
      const b = a + 1;
      const c = a + GS;
      const d = c + 1;
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  terrainMesh = new THREE.Mesh(geom, mat);
  terrainMesh.renderOrder = -1;
  scene.add(terrainMesh);
  requestRender();
}
