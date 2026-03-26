import * as THREE from 'three';
import { scene, camera, gameToViewer, boxLocalOffset, CAT_COLORS, CBP_COLOR, DEFAULT_BOX_SIZE, requestRender } from './scene.js';

// ── State ───────────────────────────────────────────────────
let saveEntityData = null;
let cbpEntityData = null;
const displayMeshes = [];
const cbpMeshes = [];
const portMeshes = [];
const catVisible = [true, true, true, true, true, true, true, true];
let cbpVisible = true;
let portsVisible = false;

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
  _quat.set(e.rx, -e.ry, -e.rz, e.rw);
  if (box) {
    _scale.set(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
    _pos.add(boxLocalOffset(box, _quat));
  } else {
    _scale.set(DEFAULT_BOX_SIZE, DEFAULT_BOX_SIZE, DEFAULT_BOX_SIZE);
  }
  _m.compose(_pos, _quat, _scale);
}

function splineMatrix(p1, p2, section) {
  const v1 = gameToViewer(p1[0], p1[1], p1[2]);
  const v2 = gameToViewer(p2[0], p2[1], p2[2]);
  _dir.set(v2.x - v1.x, v2.y - v1.y, v2.z - v1.z);
  const len = _dir.length();
  if (len < 0.01) return false;
  _dir.divideScalar(len);
  _pos.set((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, (v1.z + v2.z) / 2);
  _quat.setFromUnitVectors(_yAxis, _dir);
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

function createInstancedMesh(geom, matOptions, count, userData) {
  const mat = new THREE.MeshLambertMaterial(matOptions);
  const mesh = new THREE.InstancedMesh(geom, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.userData = userData;
  return mesh;
}

function flushBucket(bucket, geom, matOptions, computeMatrix, meshArray, cat) {
  const count = bucket.length;
  if (count === 0) return;
  const mesh = createInstancedMesh(geom, matOptions, count, {
    cat,
    instanceToEntity: new Array(count),
    baseColor: new THREE.Color(matOptions._bucketColor || 0xffffff),
  });
  for (let j = 0; j < count; j++) {
    mesh.userData.instanceToEntity[j] = bucket[j].ei;
    computeMatrix(bucket[j]);
    mesh.setMatrixAt(j, _m);
    _color.set(matOptions._bucketColor || 0xffffff);
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

function buildEntityMeshes(entities, clearance, portLayouts, displayArray, portArray, colorMode) {
  // ── Collect into buckets ──────────────────────────────────
  const catBoxBuckets = Array.from({ length: 8 }, () => []);
  const catBeltBuckets = Array.from({ length: 8 }, () => []);
  const catPipeBuckets = Array.from({ length: 8 }, () => []);
  const portMarkerBuckets = {};
  const portConeBuckets = {};

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const ei = e._ei !== undefined ? e._ei : i; // allow override for incremental

    // Boxes
    if (e.boxes) {
      for (const box of e.boxes) catBoxBuckets[e.cat].push({ ei, e, box });
    } else if (e.sp && e.sp.length >= 2) {
      const bucket = e.cat === 2 ? catBeltBuckets : catPipeBuckets;
      for (let s = 0; s < e.sp.length - 1; s++) {
        bucket[e.cat].push({ ei, p1: e.sp[s], p2: e.sp[s + 1] });
      }
    } else if (e.box) {
      catBoxBuckets[e.cat].push({ ei, e, box: e.box });
    } else {
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
      flushBucket(catBeltBuckets[cat], _boxGeom,
        { color: 0xffffff, transparent: true, opacity: splineOpacity, _bucketColor: catColor },
        (inst) => splineMatrix(inst.p1, inst.p2, BELT_SECTION),
        displayArray, cat);
    }

    if (catPipeBuckets[cat].length > 0) {
      flushBucket(catPipeBuckets[cat], _cylGeom,
        { color: 0xffffff, transparent: true, opacity: splineOpacity, _bucketColor: catColor },
        (inst) => splineMatrix(inst.p1, inst.p2, SPLINE_RADIUS),
        displayArray, cat);
    }
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
export function buildSaveScene(data) {
  saveEntityData = data;
  clearMeshes(displayMeshes);
  clearMeshes(portMeshes);
  buildEntityMeshes(data.entities, data.clearance, data.portLayouts, displayMeshes, portMeshes, 'save');
  requestRender();
  console.log('[Ports] built for', data.entities.length, 'entities');
}

export function buildCbpScene(data) {
  cbpEntityData = data;
  clearMeshes(cbpMeshes);
  buildEntityMeshes(data.entities, data.clearance, data.portLayouts || {}, cbpMeshes, [], 'cbp');
  requestRender();
}

// ── Batch edit result (single pass over meshes) ─────────────

const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);

export function applyEditResult(msg) {
  if (!saveEntityData) return;

  // Collect indices to remove from display meshes (deleted + updated)
  const removeSet = new Set(msg.deleted);
  for (const ent of msg.updated) removeSet.add(ent.index);

  // Collect indices needing port rebuild (deleted + updated + connections)
  const portRemoveSet = new Set(removeSet);
  for (const conn of msg.connections) portRemoveSet.add(conn.index);

  // 1. Apply classUpdates (cumulative — take last)
  for (const ent of [...msg.updated, ...msg.added]) {
    if (ent.classUpdate) {
      saveEntityData.classNames = ent.classUpdate.classNames;
      saveEntityData.clearance = ent.classUpdate.clearance;
      saveEntityData.portLayouts = ent.classUpdate.portLayouts;
    }
  }

  // 2. Update entity data array
  for (const ei of msg.deleted) saveEntityData.entities[ei] = null;
  for (const ent of msg.updated) saveEntityData.entities[ent.index] = ent.item;
  for (const ent of msg.added) saveEntityData.entities.push(ent.item);

  // 3. Apply connection states
  for (const conn of msg.connections) {
    const e = saveEntityData.entities[conn.index];
    if (e) e.cn = conn.connections;
  }

  // 4. Single pass: hide removed instances in display meshes
  if (removeSet.size > 0) {
    for (const mesh of displayMeshes) {
      const indices = mesh.userData?.instanceToEntity;
      if (!indices) continue;
      let dirty = false;
      for (let j = 0; j < indices.length; j++) {
        if (removeSet.has(indices[j])) {
          mesh.setMatrixAt(j, _zeroMatrix);
          dirty = true;
        }
      }
      if (dirty) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // 5. Single pass: remove port meshes for affected entities
  if (portRemoveSet.size > 0) {
    for (let i = portMeshes.length - 1; i >= 0; i--) {
      const mesh = portMeshes[i];
      const indices = mesh.userData?.instanceToEntity;
      if (!indices) continue;
      if (indices.length === 1 && portRemoveSet.has(indices[0])) {
        scene.remove(mesh);
        mesh.geometry?.dispose();
        mesh.material?.dispose();
        portMeshes.splice(i, 1);
      }
    }
  }

  // 6. Batch rebuild meshes for updated + added + connection-only entities
  const toRebuild = [];
  for (const ent of msg.updated) toRebuild.push({ ...ent.item, _ei: ent.index });
  for (const ent of msg.added) toRebuild.push({ ...ent.item, _ei: ent.index });
  const rebuiltSet = new Set([...msg.updated.map(e => e.index), ...msg.added.map(e => e.index)]);
  for (const conn of msg.connections) {
    if (!rebuiltSet.has(conn.index)) {
      const e = saveEntityData.entities[conn.index];
      if (e) toRebuild.push({ ...e, _ei: conn.index });
    }
  }
  if (toRebuild.length > 0) {
    buildEntityMeshes(toRebuild, saveEntityData.clearance, saveEntityData.portLayouts, displayMeshes, portMeshes, 'save');
  }
  requestRender();
}