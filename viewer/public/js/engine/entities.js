import * as THREE from 'three';
import { scene, camera, gameToViewer, gameToViewerQuat, boxLocalOffset, CAT_COLORS, CBP_COLOR, DEFAULT_BOX_SIZE, requestRender } from './scene.js';
import { setLabelsVisible } from './labels3d.js';
import { getMeshGeometry, getMeshMaterial, hasMeshesAvailable, initMeshCatalog, updateClassNames, loadMissingMeshes, getSplineGeometry } from './catalog.js';

// ── State ───────────────────────────────────────────────────
let saveEntityData = null;
let cbpEntityData = null;
const displayMeshes = [];
const cbpMeshes = [];
const portMeshes = [];
const catVisible = [true, true, true, true, true, true, true, true];
let cbpVisible = true;
let portsVisible = false;
let currentRenderMode = 'boxes'; // 'boxes' | 'textured'

export function getRenderMode() { return currentRenderMode; }
export function setRenderMode(mode) { currentRenderMode = mode; }

export function getSaveData() { return saveEntityData; }
export function getCbpData() { return cbpEntityData; }
export function getDisplayMeshes() { return displayMeshes; }
export function getCbpMeshes() { return cbpMeshes; }
export function getPortMeshes() { return portMeshes; }
export function getCatVisible() { return catVisible; }
export function isCbpVisible() { return cbpVisible; }
export function isPortsVisible() { return portsVisible; }

export function setCatVisible(cat, visible) {
  catVisible[cat] = visible;
  for (const mesh of displayMeshes) {
    if (mesh.userData.cat === cat) mesh.visible = visible;
  }
  for (const mesh of cbpMeshes) {
    if (mesh.userData.cat === cat) mesh.visible = visible && cbpVisible;
  }
  for (const mesh of portMeshes) {
    if (mesh.userData.cat === cat) mesh.visible = visible && portsVisible;
  }
  if (cat === 5) setLabelsVisible(visible); // Railway → station labels
  requestRender();
}

export function setPortsVisible(visible) {
  portsVisible = visible;
  for (const mesh of portMeshes) {
    mesh.visible = visible && catVisible[mesh.userData.cat];
  }
  requestRender();
}

export function setCbpVisible(visible) {
  cbpVisible = visible;
  for (const mesh of cbpMeshes) mesh.visible = visible;
  requestRender();
}

// ── Shared geometry ─────────────────────────────────────────
const _boxGeom = new THREE.BoxGeometry(1, 1, 1);
const _cylGeom = new THREE.CylinderGeometry(1, 1, 1, 6);
const _sphereGeom = new THREE.SphereGeometry(0.5, 8, 6);
const _coneGeom = new THREE.ConeGeometry(0.5, 1, 8);

// ── Shared temporaries ──────────────────────────────────────
const _m = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _color = new THREE.Color();
const _yAxis = new THREE.Vector3(0, 1, 0);

// ── Port constants ──────────────────────────────────────────
const PORT_INPUT_COLOR = new THREE.Color(0x44ff44);
const PORT_OUTPUT_COLOR = new THREE.Color(0xff8844);
const PORT_BIDIR_COLOR = new THREE.Color(0x44aaff);
const PORT_MARKER_CONNECTED = 50;
const PORT_MARKER_DISCONNECTED = 100;
const PORT_CONE_H_CONNECTED = 100;
const PORT_CONE_H_DISCONNECTED = 200;
const PORT_CONE_RADIUS = 50;
const BELT_SECTION = 30;
const SPLINE_RADIUS = 30;

function portColor(flow) {
  return flow === -1 ? PORT_BIDIR_COLOR : flow === 0 ? PORT_INPUT_COLOR : PORT_OUTPUT_COLOR;
}

// ── Matrix computations ─────────────────────────────────────

function quatRotateVec(qx, qy, qz, qw, vx, vy, vz) {
  const cx = qy * vz - qz * vy;
  const cy = qz * vx - qx * vz;
  const cz = qx * vy - qy * vx;
  const cx2 = qy * cz - qz * cy;
  const cy2 = qz * cx - qx * cz;
  const cz2 = qx * cy - qy * cx;
  return {
    x: vx + 2 * (qw * cx + cx2),
    y: vy + 2 * (qw * cy + cy2),
    z: vz + 2 * (qw * cz + cz2),
  };
}

function boxMatrix(e, box) {
  _pos.copy(gameToViewer(e.tx, e.ty, e.tz));
  _quat.copy(gameToViewerQuat(e.rx, e.ry, e.rz, e.rw));
  if (box) {
    _scale.set(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    _pos.add(boxLocalOffset(box, _quat));
  } else {
    _scale.set(DEFAULT_BOX_SIZE, DEFAULT_BOX_SIZE, DEFAULT_BOX_SIZE);
  }
  _m.compose(_pos, _quat, _scale);
}

function meshMatrix(e) {
  _pos.copy(gameToViewer(e.tx, e.ty, e.tz));
  _quat.copy(gameToViewerQuat(e.rx, e.ry, e.rz, e.rw));
  _scale.set(1, 1, 1);
  _m.compose(_pos, _quat, _scale);
}

const _up = new THREE.Vector3(0, 0, 1);
const _right = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _rotM = new THREE.Matrix4();

function splineMatrix(p1, p2, section) {
  const v1 = gameToViewer(p1[0], p1[1], p1[2]);
  const v2 = gameToViewer(p2[0], p2[1], p2[2]);
  _dir.set(v2.x - v1.x, v2.y - v1.y, v2.z - v1.z);
  const len = _dir.length();
  if (len < 0.01) return false;
  _dir.divideScalar(len);
  _pos.set((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, (v1.z + v2.z) / 2);

  // Build quaternion with consistent up vector to avoid roll twist
  _fwd.copy(_dir);
  _right.crossVectors(_fwd, _up);
  if (_right.lengthSq() < 0.001) {
    // Direction is nearly vertical — fall back to shortest rotation
    _quat.setFromUnitVectors(_yAxis, _dir);
  } else {
    _right.normalize();
    _up.crossVectors(_right, _fwd).normalize();
    _rotM.makeBasis(_right, _fwd, _up);
    _quat.setFromRotationMatrix(_rotM);
    _up.set(0, 0, 1); // restore up for next call
  }

  _scale.set(section, len, section);
  _m.compose(_pos, _quat, _scale);
  return true;
}

function portMarkerMatrix(inst) {
  const size = inst.connected ? PORT_MARKER_CONNECTED : PORT_MARKER_DISCONNECTED;
  _pos.copy(gameToViewer(inst.wx, inst.wy, inst.wz));
  _quat.identity();
  _scale.set(size, size, size);
  _m.compose(_pos, _quat, _scale);
}

function portConeMatrix(inst) {
  const coneH = inst.connected ? PORT_CONE_H_CONNECTED : PORT_CONE_H_DISCONNECTED;
  _dir.set(-inst.ndx, inst.ndy, inst.ndz); // gameToViewer: flip X
  if (_dir.lengthSq() < 0.001) _dir.set(0, 1, 0);
  _dir.normalize();
  _quat.setFromUnitVectors(_yAxis, _dir);
  _pos.copy(gameToViewer(inst.wx, inst.wy, inst.wz));
  _pos.addScaledVector(_dir, coneH / 2);
  _scale.set(PORT_CONE_RADIUS * 2, coneH, PORT_CONE_RADIUS * 2);
  _m.compose(_pos, _quat, _scale);
}

// ── Port layout helpers ─────────────────────────────────────

export function getPortLayout(e, portLayouts) {
  return e.ports || (portLayouts && portLayouts[e.c]) || null;
}

function computePorts(ei, e, portLayouts) {
  const layout = getPortLayout(e, portLayouts);
  if (!layout) return null;
  const instances = [];
  for (let pi = 0; pi < layout.length; pi++) {
    const p = layout[pi];
    const connected = e.cn ? e.cn[pi] : 0;
    const rOff = quatRotateVec(e.rx, e.ry, e.rz, e.rw, p.ox, p.oy, p.oz);
    const wx = e.tx + rOff.x, wy = e.ty + rOff.y, wz = e.tz + rOff.z;
    const rDir = quatRotateVec(e.rx, e.ry, e.rz, e.rw, p.dx, p.dy, p.dz);
    const dLen = Math.sqrt(rDir.x * rDir.x + rDir.y * rDir.y + rDir.z * rDir.z);
    instances.push({
      ei, pi, wx, wy, wz,
      ndx: dLen > 0 ? rDir.x / dLen : 0,
      ndy: dLen > 0 ? rDir.y / dLen : 0,
      ndz: dLen > 0 ? rDir.z / dLen : 0,
      cat: e.cat, ptype: p.type, flow: p.flow, connected,
    });
  }
  return instances;
}

// ── InstancedMesh creation from bucket ──────────────────────

function createInstancedMesh(geom, matOrOptions, count, userData) {
  const mat = matOrOptions.isMaterial ? matOrOptions : new THREE.MeshLambertMaterial(matOrOptions);
  const mesh = new THREE.InstancedMesh(geom, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.userData = userData;
  return mesh;
}

function flushBucket(bucket, geom, matOrOptions, computeMatrix, meshArray, cat) {
  const count = bucket.length;
  if (count === 0) return;
  const isRawMat = matOrOptions.isMaterial;
  const bucketColor = isRawMat ? 0xffffff : (matOrOptions._bucketColor || 0xffffff);
  const mesh = createInstancedMesh(geom, matOrOptions, count, {
    cat,
    instanceToEntity: new Array(count),
    baseColor: new THREE.Color(bucketColor),
  });
  for (let j = 0; j < count; j++) {
    mesh.userData.instanceToEntity[j] = bucket[j].ei;
    computeMatrix(bucket[j]);
    mesh.setMatrixAt(j, _m);
    _color.set(bucketColor);
    mesh.setColorAt(j, _color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.visible = catVisible[cat];
  scene.add(mesh);
  meshArray.push(mesh);
}

function flushPortBucket(bucket, geom, computeMatrix, meshArray) {
  const count = bucket.length;
  if (count === 0) return;
  const { cat, flow, connected } = bucket[0];
  const color = portColor(flow);
  const opacity = connected ? 0.3 : 1.0;
  const mesh = createInstancedMesh(geom, { color: 0xffffff, transparent: true, opacity, depthTest: false }, count, {
    cat, isPort: true,
    instanceToEntity: new Array(count),
    instanceToPort: new Array(count),
  });
  mesh.renderOrder = 10;
  _color.copy(color);
  for (let j = 0; j < count; j++) {
    mesh.userData.instanceToEntity[j] = bucket[j].ei;
    mesh.userData.instanceToPort[j] = bucket[j].pi;
    computeMatrix(bucket[j]);
    mesh.setMatrixAt(j, _m);
    mesh.setColorAt(j, _color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.visible = portsVisible && catVisible[cat];
  scene.add(mesh);
  meshArray.push(mesh);
}

// ── Collect + flush: single pipeline for batch and single ───

function buildEntityMeshes(entities, classNames, clearance, portLayouts, displayArray, portArray, colorMode) {
  const renderMode = currentRenderMode;
  const useMeshes = renderMode !== 'boxes';

  // ── Collect into buckets ──────────────────────────────────
  const catBoxBuckets = Array.from({ length: 8 }, () => []);
  const catBeltBuckets = Array.from({ length: 8 }, () => []);
  const catPipeBuckets = Array.from({ length: 8 }, () => []);
  const catTrackBuckets = Array.from({ length: 8 }, () => []);
  const meshBuckets = {}; // className → { cat, items[] }
  const portMarkerBuckets = {};
  const portConeBuckets = {};

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (!e) continue;
    const ei = i;

    // Splines first (belts/pipes always use spline rendering)
    if (e.boxes) {
      for (const box of e.boxes) catBoxBuckets[e.cat].push({ ei, e, box });
    } else if (e.sp && e.sp.length >= 2) {
      const bucket = e.cat === 2 ? catBeltBuckets : e.cat === 5 ? catTrackBuckets : catPipeBuckets;
      for (let s = 0; s < e.sp.length - 1; s++) {
        bucket[e.cat].push({ ei, p1: e.sp[s], p2: e.sp[s + 1] });
      }
    } else if (e.box) {
      catBoxBuckets[e.cat].push({ ei, e, box: e.box });
    } else if (useMeshes && classNames && getMeshGeometry(classNames[e.c])) {
      // Mesh bucket (per className)
      const cn = classNames[e.c];
      if (!meshBuckets[cn]) meshBuckets[cn] = { cat: e.cat, items: [] };
      meshBuckets[cn].items.push({ ei, e });
    } else {
      // Box fallback
      const boxes = clearance[e.c];
      if (boxes && boxes.length > 0) {
        for (const box of boxes) catBoxBuckets[e.cat].push({ ei, e, box });
      } else {
        catBoxBuckets[e.cat].push({ ei, e, box: null });
      }
    }

    // Ports
    const ports = computePorts(ei, e, portLayouts);
    if (ports) {
      for (const inst of ports) {
        const key = `${inst.cat}_${inst.ptype}_${inst.flow}_${inst.connected}`;
        if (!portMarkerBuckets[key]) portMarkerBuckets[key] = [];
        portMarkerBuckets[key].push(inst);
        if (!portConeBuckets[key]) portConeBuckets[key] = [];
        portConeBuckets[key].push(inst);
      }
    }
  }

  // ── Flush display meshes ──────────────────────────────────
  const isCbp = colorMode === 'cbp';
  const opacity = isCbp ? 0.3 : 0.6;
  const splineOpacity = isCbp ? 0.4 : 0.8;

  for (let cat = 0; cat < 8; cat++) {
    const catColor = isCbp ? CBP_COLOR : new THREE.Color(CAT_COLORS[cat]);

    if (catBoxBuckets[cat].length > 0) {
      flushBucket(catBoxBuckets[cat], _boxGeom,
        { color: 0xffffff, transparent: true, opacity, _bucketColor: catColor },
        (inst) => boxMatrix(inst.e, inst.box),
        displayArray, cat);
    }

    if (catBeltBuckets[cat].length > 0) {
      const beltGeom = getSplineGeometry('belt') || _boxGeom;
      const beltSection = beltGeom === _boxGeom ? BELT_SECTION : 1;
      flushBucket(catBeltBuckets[cat], beltGeom,
        { color: 0xffffff, transparent: true, opacity: splineOpacity, _bucketColor: catColor },
        (inst) => splineMatrix(inst.p1, inst.p2, beltSection),
        displayArray, cat);
    }

    if (catPipeBuckets[cat].length > 0) {
      const pipeGeom = getSplineGeometry('pipe') || _cylGeom;
      const pipeSection = pipeGeom === _cylGeom ? SPLINE_RADIUS : 1;
      flushBucket(catPipeBuckets[cat], pipeGeom,
        { color: 0xffffff, transparent: true, opacity: splineOpacity, _bucketColor: catColor },
        (inst) => splineMatrix(inst.p1, inst.p2, pipeSection),
        displayArray, cat);
    }

    if (catTrackBuckets[cat].length > 0) {
      const trackGeom = getSplineGeometry('track') || _boxGeom;
      const trackSection = trackGeom === _boxGeom ? BELT_SECTION : 1;
      flushBucket(catTrackBuckets[cat], trackGeom,
        { color: 0xffffff, transparent: true, opacity: splineOpacity, _bucketColor: catColor },
        (inst) => splineMatrix(inst.p1, inst.p2, trackSection),
        displayArray, cat);
    }
  }

  // ── Flush mesh buckets (per className) ─────────────────────
  for (const [className, bucket] of Object.entries(meshBuckets)) {
    const geom = getMeshGeometry(className);
    if (!geom) continue;
    const catColor = isCbp ? CBP_COLOR : new THREE.Color(CAT_COLORS[bucket.cat]);

    // Use textured material if available, convert PBR to Lambert for visibility
    const srcMat = getMeshMaterial(className);
    if (srcMat && srcMat.map) {
      const mat = new THREE.MeshLambertMaterial({
        map: srcMat.map,
        transparent: true,
        opacity,
      });
      flushBucket(bucket.items, geom, mat,
        (inst) => meshMatrix(inst.e),
        displayArray, bucket.cat);
      continue;
    }
    // Fallback: flat color
    flushBucket(bucket.items, geom,
      { color: 0xffffff, transparent: true, opacity, _bucketColor: catColor },
      (inst) => meshMatrix(inst.e),
      displayArray, bucket.cat);
  }

  // ── Flush port meshes ─────────────────────────────────────
  for (const bucket of Object.values(portMarkerBuckets)) {
    const geom = bucket[0].ptype === 0 ? _boxGeom : _sphereGeom;
    flushPortBucket(bucket, geom, portMarkerMatrix, portArray);
  }

  for (const bucket of Object.values(portConeBuckets)) {
    flushPortBucket(bucket, _coneGeom, portConeMatrix, portArray);
  }
}

// ── Clear meshes ────────────────────────────────────────────
function clearMeshes(meshArray) {
  for (const mesh of meshArray) scene.remove(mesh);
  meshArray.length = 0;
}

// ── Build scenes ────────────────────────────────────────────
let pendingEdits = [];

export function buildSaveScene(data) {
  saveEntityData = data;
  pendingRefresh = false;
  clearMeshes(displayMeshes);
  clearMeshes(portMeshes);
  buildEntityMeshes(data.entities, data.classNames, data.clearance, data.portLayouts, displayMeshes, portMeshes, 'save');
  requestRender();

  // Replay any edits that arrived before data was ready
  if (pendingEdits.length > 0) {
    console.log(`[Edit] replaying ${pendingEdits.length} queued edits`);
    for (const msg of pendingEdits) applyEditResult(msg);
    pendingEdits = [];
  }

  // Async mesh loading (if render mode uses meshes)
  if (currentRenderMode !== 'boxes') {
    initMeshCatalog(data.classNames).then(() => {
      if (hasMeshesAvailable()) {
        rebuildSaveScene();
      }
    });
  }
}

export function rebuildSaveScene() {
  if (!saveEntityData) return;
  clearMeshes(displayMeshes);
  clearMeshes(portMeshes);
  buildEntityMeshes(saveEntityData.entities, saveEntityData.classNames, saveEntityData.clearance, saveEntityData.portLayouts, displayMeshes, portMeshes, 'save');
  requestRender();
}

export function buildCbpScene(data) {
  cbpEntityData = data;
  clearMeshes(cbpMeshes);
  buildEntityMeshes(data.entities, data.classNames, data.clearance, data.portLayouts || {}, cbpMeshes, [], 'cbp');
  requestRender();
}

// ── Batch edit result ───────────────────────────────────────

let pendingRefresh = false;

export function applyEditResult(msg, { refreshFn } = {}) {
  if (!saveEntityData) {
    pendingEdits.push(msg);
    // Trigger a data refresh to bootstrap saveEntityData (once)
    if (!pendingRefresh && refreshFn) {
      pendingRefresh = true;
      refreshFn();
    }
    return;
  }

  // 1. Apply class metadata updates
  for (const ent of [...msg.updated, ...msg.added]) {
    if (ent.classUpdate) {
      saveEntityData.classNames = ent.classUpdate.classNames;
      saveEntityData.clearance = ent.classUpdate.clearance;
      saveEntityData.portLayouts = ent.classUpdate.portLayouts;
      updateClassNames(ent.classUpdate.classNames);
    }
  }

  // 2. Update entity data array
  for (const ei of msg.deleted) saveEntityData.entities[ei] = null;
  for (const ent of msg.updated) saveEntityData.entities[ent.index] = ent.item;
  for (const ent of msg.added) saveEntityData.entities.push(ent.item);

  // 3. Full rebuild from authoritative data (cn already correct in ent.item)
  rebuildSaveScene();

  // 5. Load missing meshes for new classes (async — triggers second rebuild when ready)
  if (currentRenderMode !== 'boxes') {
    loadMissingMeshes().then(loaded => {
      if (loaded) rebuildSaveScene();
    });
  }
}