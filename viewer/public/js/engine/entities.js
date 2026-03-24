import * as THREE from 'three';
import { scene, camera, gameToViewer, CAT_COLORS, CBP_COLOR, DEFAULT_BOX_SIZE } from './scene.js';

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
}

export function setPortsVisible(visible) {
  portsVisible = visible;
  for (const mesh of portMeshes) {
    const cat = mesh.userData.cat;
    mesh.visible = visible && catVisible[cat];
  }
}

export function setCbpVisible(visible) {
  cbpVisible = visible;
  for (const mesh of cbpMeshes) mesh.visible = visible;
}

// ── Spline helpers ──────────────────────────────────────────
const _segDir = new THREE.Vector3();
const _segMid = new THREE.Vector3();
const _segQuat = new THREE.Quaternion();
const SPLINE_RADIUS = 30;

function splineSegmentMatrix(p1, p2, matrix) {
  const v1 = gameToViewer(p1[0], p1[1], p1[2]);
  const v2 = gameToViewer(p2[0], p2[1], p2[2]);
  _segDir.set(v2.x - v1.x, v2.y - v1.y, v2.z - v1.z);
  const len = _segDir.length();
  if (len < 0.01) return false;
  _segDir.divideScalar(len);
  _segMid.set((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, (v1.z + v2.z) / 2);
  const _yAxis = new THREE.Vector3(0, 1, 0);
  _segQuat.setFromUnitVectors(_yAxis, _segDir);
  matrix.compose(_segMid, _segQuat, new THREE.Vector3(SPLINE_RADIUS, len, SPLINE_RADIUS));
  return true;
}

// ── Create InstancedMesh ────────────────────────────────────
function createDisplayMesh(geom, color, count, cat, opacity = 0.6) {
  const mat = new THREE.MeshLambertMaterial({
    color: 0xffffff, transparent: true, opacity,
  });
  const mesh = new THREE.InstancedMesh(geom, mat, count);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
  mesh.userData = { cat, instanceToEntity: new Array(count), baseColor: new THREE.Color(color) };
  return mesh;
}

// ── Belt spline segment (box) ───────────────────────────────
const BELT_SECTION = 30; // 30u = ~0.3m square section

function beltSegmentMatrix(p1, p2, matrix) {
  const v1 = gameToViewer(p1[0], p1[1], p1[2]);
  const v2 = gameToViewer(p2[0], p2[1], p2[2]);
  _segDir.set(v2.x - v1.x, v2.y - v1.y, v2.z - v1.z);
  const len = _segDir.length();
  if (len < 0.01) return false;
  _segDir.divideScalar(len);
  _segMid.set((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, (v1.z + v2.z) / 2);
  const _yAxis = new THREE.Vector3(0, 1, 0);
  _segQuat.setFromUnitVectors(_yAxis, _segDir);
  matrix.compose(_segMid, _segQuat, new THREE.Vector3(BELT_SECTION, len, BELT_SECTION));
  return true;
}

// ── Lift rendering constants ────────────────────────────────
const LIFT_SHAFT_SECTION = 30;   // 30cm shaft
const LIFT_END_SIZE = 50;        // 50cm endpoint cubes

// ── Build meshes from entity data ───────────────────────────
function buildMeshes(data, meshArray, colorMode) {
  const { classNames, clearance, entities } = data;

  const catBoxInstances = Array.from({ length: 8 }, () => []);
  const catBeltSplineInstances = Array.from({ length: 8 }, () => []);
  const catPipeSplineInstances = Array.from({ length: 8 }, () => []);
  const catLiftInstances = []; // { ei, p1, p2 }

  for (let ei = 0; ei < entities.length; ei++) {
    const e = entities[ei];
    if (e.lift && e.lift.length === 2) {
      // ConveyorLift → special rendering
      catLiftInstances.push({ ei, p1: e.lift[0], p2: e.lift[1], cat: e.cat });
    } else if (e.sp && e.sp.length >= 2) {
      const isBelt = e.cat === 2; // Belts category
      const bucket = isBelt ? catBeltSplineInstances : catPipeSplineInstances;
      for (let s = 0; s < e.sp.length - 1; s++) {
        bucket[e.cat].push({ ei, p1: e.sp[s], p2: e.sp[s + 1] });
      }
    } else if (e.box) {
      catBoxInstances[e.cat].push({ ei, box: e.box });
    } else {
      const boxes = clearance[e.c];
      if (boxes && boxes.length > 0) {
        for (const box of boxes) catBoxInstances[e.cat].push({ ei, box });
      } else {
        catBoxInstances[e.cat].push({ ei, box: null });
      }
    }
  }

  const boxGeom = new THREE.BoxGeometry(1, 1, 1);
  const cylGeom = new THREE.CylinderGeometry(1, 1, 1, 6);
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const boxOffset = new THREE.Vector3();
  const color = new THREE.Color();

  const isCbp = colorMode === 'cbp';
  const opacity = isCbp ? 0.3 : 0.6;
  const splineOpacity = isCbp ? 0.4 : 0.8;

  for (let cat = 0; cat < 8; cat++) {
    // Boxes
    const boxInsts = catBoxInstances[cat];
    if (boxInsts.length > 0) {
      const catColor = isCbp ? CBP_COLOR : new THREE.Color(CAT_COLORS[cat]);
      const mesh = createDisplayMesh(boxGeom, catColor, boxInsts.length, cat, opacity);
      color.copy(catColor);
      for (let j = 0; j < boxInsts.length; j++) {
        const { ei, box } = boxInsts[j];
        const e = entities[ei];
        mesh.userData.instanceToEntity[j] = ei;
        pos.copy(gameToViewer(e.tx, e.ty, e.tz));
        quat.set(e.rx, -e.ry, -e.rz, e.rw);
        if (box) {
          scale.set(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
          boxOffset.set(
            (box.min.x + box.max.x) / 2 + (box.rt ? box.rt.x : 0),
            (box.min.y + box.max.y) / 2 + (box.rt ? box.rt.y : 0),
            (box.min.z + box.max.z) / 2 + (box.rt ? box.rt.z : 0),
          );
          boxOffset.applyQuaternion(quat);
          pos.add(boxOffset);
        } else {
          scale.set(DEFAULT_BOX_SIZE, DEFAULT_BOX_SIZE, DEFAULT_BOX_SIZE);
        }
        matrix.compose(pos, quat, scale);
        mesh.setMatrixAt(j, matrix);
        mesh.setColorAt(j, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      meshArray.push(mesh);
    }

    // Belt splines (box section)
    const beltInsts = catBeltSplineInstances[cat];
    if (beltInsts.length > 0) {
      const catColor = isCbp ? CBP_COLOR : new THREE.Color(CAT_COLORS[cat]);
      const mesh = createDisplayMesh(boxGeom, catColor, beltInsts.length, cat, splineOpacity);
      color.copy(catColor);
      for (let j = 0; j < beltInsts.length; j++) {
        const { ei, p1, p2 } = beltInsts[j];
        mesh.userData.instanceToEntity[j] = ei;
        if (beltSegmentMatrix(p1, p2, matrix)) {
          mesh.setMatrixAt(j, matrix);
        }
        mesh.setColorAt(j, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      meshArray.push(mesh);
    }

    // Pipe splines (cylinder section)
    const pipeInsts = catPipeSplineInstances[cat];
    if (pipeInsts.length > 0) {
      const catColor = isCbp ? CBP_COLOR : new THREE.Color(CAT_COLORS[cat]);
      const mesh = createDisplayMesh(cylGeom, catColor, pipeInsts.length, cat, splineOpacity);
      color.copy(catColor);
      for (let j = 0; j < pipeInsts.length; j++) {
        const { ei, p1, p2 } = pipeInsts[j];
        mesh.userData.instanceToEntity[j] = ei;
        if (splineSegmentMatrix(p1, p2, matrix)) {
          mesh.setMatrixAt(j, matrix);
        }
        mesh.setColorAt(j, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
      scene.add(mesh);
      meshArray.push(mesh);
    }
  }

  // Lifts: shaft (box) + 2 endpoint cubes
  if (catLiftInstances.length > 0) {
    // 3 instances per lift: shaft + bottom cube + top cube
    const totalInsts = catLiftInstances.length * 3;
    const liftCat = 2; // Belts category
    const catColor = isCbp ? CBP_COLOR : new THREE.Color(CAT_COLORS[liftCat]);
    const mesh = createDisplayMesh(boxGeom, catColor, totalInsts, liftCat, splineOpacity);
    color.copy(catColor);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const dir = new THREE.Vector3();

    let j = 0;
    for (const { ei, p1, p2 } of catLiftInstances) {
      const v1 = gameToViewer(p1[0], p1[1], p1[2]);
      const v2 = gameToViewer(p2[0], p2[1], p2[2]);
      dir.set(v2.x - v1.x, v2.y - v1.y, v2.z - v1.z);
      const len = dir.length();

      if (len < 0.01) {
        // Degenerate lift, skip
        for (let k = 0; k < 3; k++) { mesh.userData.instanceToEntity[j] = ei; mesh.setColorAt(j, color); j++; }
        continue;
      }

      dir.divideScalar(len);
      const liftQuat = new THREE.Quaternion().setFromUnitVectors(yAxis, dir);
      const mid = new THREE.Vector3((v1.x + v2.x) / 2, (v1.y + v2.y) / 2, (v1.z + v2.z) / 2);

      // Shaft
      mesh.userData.instanceToEntity[j] = ei;
      matrix.compose(mid, liftQuat, new THREE.Vector3(LIFT_SHAFT_SECTION, len, LIFT_SHAFT_SECTION));
      mesh.setMatrixAt(j, matrix);
      mesh.setColorAt(j, color);
      j++;

      // Bottom endpoint cube
      mesh.userData.instanceToEntity[j] = ei;
      quat.identity();
      matrix.compose(v1, quat, new THREE.Vector3(LIFT_END_SIZE, LIFT_END_SIZE, LIFT_END_SIZE));
      mesh.setMatrixAt(j, matrix);
      mesh.setColorAt(j, color);
      j++;

      // Top endpoint cube
      mesh.userData.instanceToEntity[j] = ei;
      matrix.compose(v2, quat, new THREE.Vector3(LIFT_END_SIZE, LIFT_END_SIZE, LIFT_END_SIZE));
      mesh.setMatrixAt(j, matrix);
      mesh.setColorAt(j, color);
      j++;
    }

    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    scene.add(mesh);
    meshArray.push(mesh);
  }
}

// ── Port rendering ─────────────────────────────────────────
const PORT_INPUT_COLOR = new THREE.Color(0x44ff44);
const PORT_OUTPUT_COLOR = new THREE.Color(0xff8844);
const PORT_MARKER_CONNECTED = 50;
const PORT_MARKER_DISCONNECTED = 100;
const PORT_CONE_H_CONNECTED = 100;
const PORT_CONE_H_DISCONNECTED = 200;
const PORT_CONE_RADIUS = 50;

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

function buildPortMeshes(data) {
  const { classNames, entities, portLayouts } = data;
  if (!portLayouts) return;

  // Log which classNames have port layouts
  const portClassCounts = {};
  for (let ei = 0; ei < entities.length; ei++) {
    const e = entities[ei];
    if (portLayouts[e.c]) {
      const cls = classNames[e.c];
      portClassCounts[cls] = (portClassCounts[cls] || 0) + 1;
    }
  }
  console.log('[Ports] Classes with ports:', portClassCounts);

  // Collect all port instances grouped by: cat × portType × flow × connected
  // Key = `${cat}_${portType}_${flow}_${connected}`
  const markerBuckets = {};
  const coneBuckets = {};

  for (let ei = 0; ei < entities.length; ei++) {
    const e = entities[ei];
    const layout = portLayouts[e.c];
    if (!layout) continue;

    for (let pi = 0; pi < layout.length; pi++) {
      const p = layout[pi];
      const connected = e.cn ? e.cn[pi] : 0;

      // Rotate offset by entity quaternion (in Unreal space)
      const rOff = quatRotateVec(e.rx, e.ry, e.rz, e.rw, p.ox, p.oy, p.oz);
      const wx = e.tx + rOff.x;
      const wy = e.ty + rOff.y;
      const wz = e.tz + rOff.z;

      // Rotate direction by entity quaternion (in Unreal space)
      const rDir = quatRotateVec(e.rx, e.ry, e.rz, e.rw, p.dx, p.dy, p.dz);
      // Normalize direction
      const dLen = Math.sqrt(rDir.x * rDir.x + rDir.y * rDir.y + rDir.z * rDir.z);
      const ndx = dLen > 0 ? rDir.x / dLen : 0;
      const ndy = dLen > 0 ? rDir.y / dLen : 0;
      const ndz = dLen > 0 ? rDir.z / dLen : 0;

      const key = `${e.cat}_${p.type}_${p.flow}_${connected}`;
      if (!markerBuckets[key]) markerBuckets[key] = [];
      markerBuckets[key].push({ ei, pi, wx, wy, wz, cat: e.cat, ptype: p.type, flow: p.flow, connected });

      if (!coneBuckets[key]) coneBuckets[key] = [];
      coneBuckets[key].push({ ei, pi, wx, wy, wz, ndx, ndy, ndz, cat: e.cat, flow: p.flow, connected });
    }
  }

  const boxGeom = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeom = new THREE.SphereGeometry(0.5, 8, 6);
  const coneGeom = new THREE.ConeGeometry(0.5, 1, 8);
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const color = new THREE.Color();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();

  // Build marker meshes
  for (const [key, bucket] of Object.entries(markerBuckets)) {
    const { cat, ptype, flow, connected } = bucket[0];
    const geom = ptype === 0 ? boxGeom : sphereGeom; // 0=belt→box, 1=pipe→sphere
    const baseColor = flow === 0 ? PORT_INPUT_COLOR : PORT_OUTPUT_COLOR;
    const size = connected ? PORT_MARKER_CONNECTED : PORT_MARKER_DISCONNECTED;
    const opacity = connected ? 0.3 : 1.0;

    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity,
    });
    const mesh = new THREE.InstancedMesh(geom, mat, bucket.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bucket.length * 3), 3);
    mesh.userData = { cat, isPort: true, instanceToEntity: new Array(bucket.length), instanceToPort: new Array(bucket.length) };

    color.copy(baseColor);
    for (let j = 0; j < bucket.length; j++) {
      const inst = bucket[j];
      mesh.userData.instanceToEntity[j] = inst.ei;
      mesh.userData.instanceToPort[j] = inst.pi;
      pos.copy(gameToViewer(inst.wx, inst.wy, inst.wz));
      scl.set(size, size, size);
      quat.identity();
      matrix.compose(pos, quat, scl);
      mesh.setMatrixAt(j, matrix);
      mesh.setColorAt(j, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.visible = portsVisible && catVisible[cat];
    scene.add(mesh);
    portMeshes.push(mesh);
  }

  // Build cone meshes (direction indicators)
  for (const [key, bucket] of Object.entries(coneBuckets)) {
    const { cat, flow, connected } = bucket[0];
    const baseColor = flow === 0 ? PORT_INPUT_COLOR : PORT_OUTPUT_COLOR;
    const coneH = connected ? PORT_CONE_H_CONNECTED : PORT_CONE_H_DISCONNECTED;
    const opacity = connected ? 0.3 : 1.0;

    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity,
    });
    const mesh = new THREE.InstancedMesh(coneGeom, mat, bucket.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bucket.length * 3), 3);
    mesh.userData = { cat, isPort: true, instanceToEntity: new Array(bucket.length), instanceToPort: new Array(bucket.length) };

    color.copy(baseColor);
    for (let j = 0; j < bucket.length; j++) {
      const inst = bucket[j];
      mesh.userData.instanceToEntity[j] = inst.ei;
      mesh.userData.instanceToPort[j] = inst.pi;
      // Cone tip should point in the port direction
      // ConeGeometry points along +Y by default, tip at top
      // We need to orient Y axis → port direction (in viewer space)
      dir.set(-inst.ndx, inst.ndy, inst.ndz); // gameToViewer: flip X
      if (dir.lengthSq() < 0.001) dir.set(0, 1, 0);
      dir.normalize();
      quat.setFromUnitVectors(yAxis, dir);

      // Position the cone so its base is at the port position
      // ConeGeometry center is at the middle, so offset by half height along direction
      pos.copy(gameToViewer(inst.wx, inst.wy, inst.wz));
      pos.addScaledVector(dir, coneH / 2);

      scl.set(PORT_CONE_RADIUS * 2, coneH, PORT_CONE_RADIUS * 2);
      matrix.compose(pos, quat, scl);
      mesh.setMatrixAt(j, matrix);
      mesh.setColorAt(j, color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.visible = portsVisible && catVisible[cat];
    scene.add(mesh);
    portMeshes.push(mesh);
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
  buildMeshes(data, displayMeshes, 'save');
  buildPortMeshes(data);
}

export function buildCbpScene(data) {
  cbpEntityData = data;
  clearMeshes(cbpMeshes);
  buildMeshes(data, cbpMeshes, 'cbp');
}
