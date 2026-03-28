import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { renderer, scene, gameToViewer, requestRender } from './scene.js';

// ── GLB to viewer transform (same as meshCatalog) ──────────
// glTF(x,y,z) → viewer(-x*100, z*100, y*100)
const _glbToViewer = new THREE.Matrix4().set(
  -100,   0,    0,   0,
     0,   0,  100,   0,
     0, 100,    0,   0,
     0,   0,    0,   1,
);

// ── State ──────────────────────────────────────────────────
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const sceneryGroup = new THREE.Group();
sceneryGroup.name = 'scenery';
scene.add(sceneryGroup);

let sceneryVisible = true;
let loaded = false;
let terrainProjectionMap = null; // RenderTarget texture for terrain top-down projection
let terrainProjectionBounds = null; // computed dynamically from terrain tiles

// ── Resource node mesh mapping ──────────────────────────────
const RESOURCE_MESH = {
  Desc_OreIron_C:    'ResourceNode_OreIron_01',
  Desc_OreCopper_C:  'ResourceNode_OreCopper_01',
  Desc_Stone_C:      'Resource_Stone_01',
  Desc_Coal_C:       'CoalResource_01',
  Desc_OreGold_C:    'ResourceNode_OreGold_01',
  Desc_RawQuartz_C:  'ResourceNode_quartz',
  Desc_Sulfur_C:     'SulfurResource_01',
  Desc_OreBauxite_C: 'ResourceNode_OreIron_01', // no specific mesh, use iron
  Desc_OreUranium_C: 'ResourceNode_OreIron_01',
  Desc_LiquidOil_C:  'ResourceNode_OreIron_01',
  Desc_SAM_C:        'SM_SAM_Node_01',
};

const RESOURCE_COLORS = {
  Desc_OreIron_C:    0xb87333,
  Desc_OreCopper_C:  0xcd7f32,
  Desc_Stone_C:      0xc8c0b0,
  Desc_Coal_C:       0x333333,
  Desc_OreGold_C:    0xffd700,
  Desc_RawQuartz_C:  0xffccdd,
  Desc_Sulfur_C:     0xdddd00,
  Desc_OreBauxite_C: 0xcc6644,
  Desc_OreUranium_C: 0x44ff44,
  Desc_LiquidOil_C:  0x222222,
  Desc_SAM_C:        0x6633cc,
};

// ── Public API ─────────────────────────────────────────────
export function setSceneryVisible(visible) {
  sceneryVisible = visible;
  sceneryGroup.visible = visible;
  requestRender();
}

export function isSceneryLoaded() { return loaded; }

let currentSceneryLod = (typeof localStorage !== 'undefined' && localStorage.getItem('viewer_display')) || 'lod2';
if (currentSceneryLod === 'boxes') currentSceneryLod = 'lod2'; // boxes mode has no scenery LOD, use default

export async function setSceneryLod(lod) {
  if (lod === currentSceneryLod && loaded) return false;
  currentSceneryLod = lod;
  await buildScenery();
  return true;
}

export async function buildScenery() {
  // Bake terrain projection texture if not done yet
  if (!terrainProjectionMap) bakeTerrainProjection();

  // Clear previous
  while (sceneryGroup.children.length > 0) {
    const c = sceneryGroup.children[0];
    sceneryGroup.remove(c);
    if (c.geometry) c.geometry.dispose();
    if (c.material) {
      if (c.material.map) c.material.map.dispose();
      c.material.dispose();
    }
  }

  const res = await fetch(`/api/scenery?lod=${currentSceneryLod}`);
  const data = await res.json();
  const { bpActors = [], streaming = [], availableMeshes = [], availableTextures = [] } = data;
  const availableSet = new Set(availableMeshes);
  const textureSet = new Set(availableTextures);

  console.log(`[Scenery] ${bpActors.length} BP actors, ${streaming.length} streaming actors`);

  // ── Load resource nodes with real meshes ─────────────────
  const nodesByResource = {};
  for (const actor of bpActors) {
    if (actor.type !== 'BP_ResourceNode_C') continue;
    const key = actor.resource || 'unknown';
    if (!nodesByResource[key]) nodesByResource[key] = [];
    nodesByResource[key].push(actor);
  }

  // Load unique mesh geometries + materials
  const meshCache = new Map(); // meshName → { geometry, material }
  const uniqueMeshNames = [...new Set(Object.values(RESOURCE_MESH))];
  await Promise.allSettled(uniqueMeshNames.map(async (meshName) => {
    const result = await loadSceneryGeometry(meshName);
    if (result) meshCache.set(meshName, result);
  }));

  // Fallback sphere for meshes that failed to load
  const fallbackGeom = new THREE.SphereGeometry(300, 8, 6);

  for (const [resource, nodes] of Object.entries(nodesByResource)) {
    const meshName = RESOURCE_MESH[resource];
    const cached = meshCache.get(meshName);
    const geom = cached?.geometry || fallbackGeom;
    const color = RESOURCE_COLORS[resource] || 0x888888;
    const mat = new THREE.MeshLambertMaterial({ color });
    const instanced = new THREE.InstancedMesh(geom, mat, nodes.length);
    instanced.name = `nodes_${resource}`;
    const dummy = new THREE.Object3D();

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      dummy.position.copy(gameToViewer(n.x, n.y, n.z));
      dummy.quaternion.set(n.qx || 0, -(n.qy || 0), -(n.qz || 0), n.qw || 1);
      // Actor scale is collision zone, not visual — use scale 1 for mesh
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    instanced.visible = sceneryVisible;
    sceneryGroup.add(instanced);
  }

  // ── Load geysers with real mesh or fallback ────────────
  const geysers = bpActors.filter(a => a.type === 'BP_ResourceNodeGeyser_C');
  if (geysers.length > 0) {
    const geyserGeom = fallbackGeom; // no specific geyser mesh extracted
    const geyserMat = new THREE.MeshLambertMaterial({ color: 0x4488cc });
    const geyserMesh = new THREE.InstancedMesh(geyserGeom, geyserMat, geysers.length);
    geyserMesh.name = 'geysers';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < geysers.length; i++) {
      const g = geysers[i];
      dummy.position.copy(gameToViewer(g.x, g.y, g.z));
      dummy.quaternion.set(g.qx || 0, -(g.qy || 0), -(g.qz || 0), g.qw || 1);
      dummy.scale.set(g.sx || 1, g.sy || 1, g.sz || 1);
      dummy.updateMatrix();
      geyserMesh.setMatrixAt(i, dummy.matrix);
    }
    geyserMesh.instanceMatrix.needsUpdate = true;
    sceneryGroup.add(geyserMesh);
  }

  // ── Load streaming actors (rocks, cliffs from world partition cells) ──
  // Filter out backdrop actors (outside terrain bounds + margin, or huge scale)
  const MAP_MIN_X = -260000, MAP_MAX_X = 460000;
  const MAP_MIN_Y = -260000, MAP_MAX_Y = 360000;
  const MAX_SCALE = 20;
  const byMesh = {};
  for (const sm of streaming) {
    if (!sm.mesh || sm.mesh === 'None') continue;
    if (sm.x < MAP_MIN_X || sm.x > MAP_MAX_X || sm.y < MAP_MIN_Y || sm.y > MAP_MAX_Y) continue;
    if (Math.abs(sm.sx || 1) > MAX_SCALE || Math.abs(sm.sy || 1) > MAX_SCALE || Math.abs(sm.sz || 1) > MAX_SCALE) continue;
    if (!byMesh[sm.mesh]) byMesh[sm.mesh] = [];
    byMesh[sm.mesh].push(sm);
  }

  const meshNames = Object.keys(byMesh).filter(n => availableSet.has(n));
  let loadedMeshes = 0;
  const BATCH = 20;

  for (let i = 0; i < meshNames.length; i += BATCH) {
    const batch = meshNames.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map(name => loadSceneryInstances(name, byMesh[name], textureSet))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) loadedMeshes++;
    }
    requestRender();
  }

  // ── Load fracking satellites/cores by resource type ─────
  const FRACKING_COLORS = {
    Desc_NitrogenGas_C: 0xff8800,
    Desc_Water_C:       0x2266cc,
    Desc_LiquidOil_C:   0x222222,
  };
  const frackingSatellites = bpActors.filter(a => a.type === 'BP_FrackingSatellite_C');
  const frackingCores = bpActors.filter(a => a.type === 'BP_FrackingCore_C');

  // Load fracking mesh
  const frackResult = await loadSceneryGeometry('SM_FrackingNode_Crack_01');
  const frackGeom = frackResult?.geometry || fallbackGeom;
  const frackCoreResult = await loadSceneryGeometry('SM_FrackingNode_Mid_01');
  const frackCoreGeom = frackCoreResult?.geometry || fallbackGeom;

  // Group satellites by resource
  const satByRes = {};
  for (const sat of frackingSatellites) {
    const key = sat.resource || 'unknown';
    if (!satByRes[key]) satByRes[key] = [];
    satByRes[key].push(sat);
  }

  for (const [resource, sats] of Object.entries(satByRes)) {
    const color = FRACKING_COLORS[resource] || 0x888888;
    const mat = new THREE.MeshLambertMaterial({ color });
    const instanced = new THREE.InstancedMesh(frackGeom, mat, sats.length);
    instanced.name = `fracking_${resource}`;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < sats.length; i++) {
      const s = sats[i];
      dummy.position.copy(gameToViewer(s.x, s.y, s.z));
      dummy.quaternion.set(s.qx || 0, -(s.qy || 0), -(s.qz || 0), s.qw || 1);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }
    instanced.instanceMatrix.needsUpdate = true;
    instanced.visible = sceneryVisible;
    sceneryGroup.add(instanced);
  }

  // Fracking cores
  if (frackingCores.length > 0) {
    const coreInstanced = new THREE.InstancedMesh(
      frackCoreGeom,
      new THREE.MeshLambertMaterial({ color: 0xaa6600 }),
      frackingCores.length
    );
    coreInstanced.name = 'fracking_cores';
    const dummy = new THREE.Object3D();
    for (let i = 0; i < frackingCores.length; i++) {
      const c = frackingCores[i];
      dummy.position.copy(gameToViewer(c.x, c.y, c.z));
      dummy.quaternion.set(c.qx || 0, -(c.qy || 0), -(c.qz || 0), c.qw || 1);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      coreInstanced.setMatrixAt(i, dummy.matrix);
    }
    coreInstanced.instanceMatrix.needsUpdate = true;
    coreInstanced.visible = sceneryVisible;
    sceneryGroup.add(coreInstanced);
  }

  loaded = true;
  window._sceneryGroup = sceneryGroup;
  const nodeCount = Object.values(nodesByResource).reduce((s, a) => s + a.length, 0);
  const streamCount = Object.values(byMesh).reduce((s, a) => s + a.length, 0);
  // Count textured vs flat materials
  let textured = 0, flat = 0;
  for (const c of sceneryGroup.children) {
    if (c.material?.map) textured++; else flat++;
  }
  console.log(`[Scenery] Loaded: ${nodeCount} nodes, ${geysers.length} geysers, ${frackingSatellites.length} fracking, ${loadedMeshes} mesh types (${streamCount} instances), ${textured} textured, ${flat} flat`);
  requestRender();
}

// ── Load a scenery GLB and return { geometry, material } ────
async function loadSceneryGeometry(meshName) {
  try {
    const gltf = await gltfLoader.loadAsync(`/meshes/scenery/${currentSceneryLod}/${meshName}.glb`);

    const geometries = [];
    let material = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(child => {
      if (!child.isMesh) return;
      const geom = child.geometry.clone();
      if (!child.matrixWorld.equals(new THREE.Matrix4())) {
        geom.applyMatrix4(child.matrixWorld);
      }
      geometries.push(geom);
      if (!material && child.material) {
        material = child.material.clone();
      }
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
    return { geometry: merged, material };
  } catch {
    return null;
  }
}

// ── Load scenery GLB + create InstancedMesh with transforms ─
// Rock/cliff mesh patterns — only these get terrain projection material
const ROCK_PATTERN = /^(Arc|Boulder|Cave|Cliff|Desert|Hotspring|MERGED_BP_Cave|MergedArc|Pebble|Plateau|Ribrock|Rock|Rubble|SeaRock|Smooth|SM_(Boulder|Broken|Cave|Desert|Pebble|Rock|Rubble|SeaRock|Smooth))/i;

function isRockMesh(name) {
  return ROCK_PATTERN.test(name);
}

async function loadSceneryInstances(meshName, instances, textureSet) {
  const result = await loadSceneryGeometry(meshName);
  if (!result) return null;

  // Terrain projection for rocks; for other meshes try loading the extracted diffuse PNG
  let mat;
  if (isRockMesh(meshName)) {
    mat = createTerrainProjectionMaterial() || new THREE.MeshLambertMaterial({ color: 0x887766 });
  } else if (textureSet?.has(meshName)) {
    const tex = await textureLoader.loadAsync(`/meshes/scenery/textures/${meshName}.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    mat = new THREE.MeshLambertMaterial({ map: tex });
  } else {
    mat = result.material || new THREE.MeshLambertMaterial({ color: 0x887766 });
  }
  const instanced = new THREE.InstancedMesh(result.geometry, mat, instances.length);
  instanced.name = `scenery_${meshName}`;

  const dummy = new THREE.Object3D();
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    dummy.position.copy(gameToViewer(inst.x, inst.y, inst.z));
    dummy.quaternion.set(inst.qx, -(inst.qy), -(inst.qz), inst.qw);
    dummy.scale.set(inst.sx || 1, inst.sy || 1, inst.sz || 1);
    dummy.updateMatrix();
    instanced.setMatrixAt(i, dummy.matrix);
  }

  instanced.instanceMatrix.needsUpdate = true;
  instanced.visible = sceneryVisible;
  sceneryGroup.add(instanced);
  return instanced;
}

// ── (legacy) Load a scenery mesh and create InstancedMesh ───
async function loadSceneryMesh(meshName, instances) {
  try {
    const gltf = await gltfLoader.loadAsync(`/meshes/scenery/${currentSceneryLod}/${meshName}.glb`);

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

    const mat = new THREE.MeshLambertMaterial({ color: 0x887766 });
    const instanced = new THREE.InstancedMesh(merged, mat, instances.length);
    instanced.name = `scenery_${meshName}`;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      dummy.position.copy(gameToViewer(inst.x, inst.y, inst.z));

      // Quaternion: same conversion as entities.js — negate Y and Z for X-flip
      dummy.quaternion.set(inst.qx, -(inst.qy), -(inst.qz), inst.qw);
      dummy.scale.set(inst.sx || 1, inst.sy || 1, inst.sz || 1);
      dummy.updateMatrix();
      instanced.setMatrixAt(i, dummy.matrix);
    }

    instanced.instanceMatrix.needsUpdate = true;
    instanced.visible = sceneryVisible;
    sceneryGroup.add(instanced);
    return instanced;
  } catch {
    // GLB not found for this mesh — skip silently
    return null;
  }
}

// ── Bake terrain to a top-down texture for projection ──────
export function bakeTerrainProjection(resolution = 2048) {
  // Compute bounds dynamically from actual terrain tile positions
  const terrainMeshes = window._terrainMeshes || [];
  if (terrainMeshes.length === 0) { console.warn('[Scenery] No terrain meshes for bake'); return null; }
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const m of terrainMeshes) {
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    b.minX = Math.min(b.minX, bb.min.x + m.position.x);
    b.maxX = Math.max(b.maxX, bb.max.x + m.position.x);
    b.minY = Math.min(b.minY, bb.min.y + m.position.y);
    b.maxY = Math.max(b.maxY, bb.max.y + m.position.y);
  }
  console.log(`[Scenery] Terrain bounds: X[${b.minX}, ${b.maxX}] Y[${b.minY}, ${b.maxY}]`);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  const aspect = width / height;

  // Orthographic camera looking down (viewer Z is up)
  // left/right/top/bottom are relative to camera position
  const halfW = width / 2, halfH = height / 2;
  const ortho = new THREE.OrthographicCamera(
    -halfW, halfW, halfH, -halfH, -200000, 200000
  );
  ortho.position.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 100000);
  ortho.up.set(0, 1, 0);
  ortho.lookAt((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 0);
  ortho.updateProjectionMatrix();

  const resX = Math.round(resolution * aspect);
  const resY = resolution;
  const rt = new THREE.WebGLRenderTarget(resX, resY, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    colorSpace: THREE.SRGBColorSpace,
  });

  // Hide everything except terrain meshes for the bake
  const visibility = new Map();
  scene.traverse(c => {
    if (c === scene) return;
    visibility.set(c, c.visible);
  });
  for (const c of scene.children) c.visible = false;
  // Swap Lambert → Basic (unlit) so the bake doesn't depend on lights
  const savedMaterials = new Map();
  for (const m of terrainMeshes) {
    m.visible = true;
    m.frustumCulled = false;
    m.renderOrder = 0; // reset from -2 during bake
    if (m.material?.map) {
      savedMaterials.set(m, m.material);
      m.material = new THREE.MeshBasicMaterial({ map: m.material.map, side: THREE.DoubleSide });
    }
  }

  const oldBg = scene.background;
  scene.background = new THREE.Color(0x000000);

  // Force shader compilation + matrix updates before bake render
  scene.updateMatrixWorld(true);
  renderer.compile(scene, ortho);

  renderer.setRenderTarget(rt);
  renderer.render(scene, ortho);
  renderer.setRenderTarget(null);

  // Restore materials and visibility
  scene.background = oldBg;
  for (const [m, mat] of savedMaterials) { m.material.dispose(); m.material = mat; }
  for (const m of terrainMeshes) { m.frustumCulled = true; m.renderOrder = -2; }
  for (const [c, v] of visibility) c.visible = v;

  terrainProjectionMap = rt.texture;
  terrainProjectionBounds = b;
  console.log(`[Scenery] Baked terrain projection ${resX}x${resY}`);
  return terrainProjectionMap;
}

// ── Material with terrain projection ─────────────────────────
function createTerrainProjectionMaterial() {
  if (!terrainProjectionMap || !terrainProjectionBounds) return null;
  const b = terrainProjectionBounds;

  const uniforms = {
    terrainMap: { value: terrainProjectionMap },
    boundsMin: { value: new THREE.Vector2(b.minX, b.minY) },
    boundsMax: { value: new THREE.Vector2(b.maxX, b.maxY) },
  };
  return new THREE.ShaderMaterial({
    defines: { USE_INSTANCING: '' },
    uniforms,
    vertexShader: /* glsl */`
      #include <common>
      varying vec3 vWorldPos;
      varying vec3 vViewNormal;
      void main() {
        #ifdef USE_INSTANCING
          mat4 localModel = modelMatrix * instanceMatrix;
        #else
          mat4 localModel = modelMatrix;
        #endif
        vec4 worldPos = localModel * vec4(position, 1.0);
        vWorldPos = worldPos.xyz;
        vViewNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D terrainMap;
      uniform vec2 boundsMin;
      uniform vec2 boundsMax;
      varying vec3 vWorldPos;
      varying vec3 vViewNormal;
      void main() {
        vec2 uv = (vWorldPos.xy - boundsMin) / (boundsMax - boundsMin);
        uv = clamp(uv, 0.0, 1.0);
        vec3 terrainColor = pow(texture2D(terrainMap, uv).rgb, vec3(1.0 / 2.2)); // linear → sRGB

        // Simple hemisphere lighting
        vec3 lightDir = normalize(vec3(0.3, 0.2, 1.0));
        float diff = max(dot(normalize(vViewNormal), lightDir), 0.0);
        gl_FragColor = vec4(terrainColor * (0.4 + 0.6 * diff), 1.0);
      }
    `,
    lights: false,
  });
}