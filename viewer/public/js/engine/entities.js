import * as THREE from 'three';
import { scene, camera, gameToViewer, CAT_COLORS, CBP_COLOR, DEFAULT_BOX_SIZE } from './scene.js';

// ── State ───────────────────────────────────────────────────
let saveEntityData = null;
let cbpEntityData = null;
const displayMeshes = [];
const cbpMeshes = [];
const catVisible = [true, true, true, true, true, true, true, true];
let cbpVisible = true;

export function getSaveData() { return saveEntityData; }
export function getCbpData() { return cbpEntityData; }
export function getDisplayMeshes() { return displayMeshes; }
export function getCbpMeshes() { return cbpMeshes; }
export function getCatVisible() { return catVisible; }
export function isCbpVisible() { return cbpVisible; }

export function setCatVisible(cat, visible) {
  catVisible[cat] = visible;
  for (const mesh of displayMeshes) {
    if (mesh.userData.cat === cat) mesh.visible = visible;
  }
  for (const mesh of cbpMeshes) {
    if (mesh.userData.cat === cat) mesh.visible = visible && cbpVisible;
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

// ── Build meshes from entity data ───────────────────────────
function buildMeshes(data, meshArray, colorMode) {
  const { classNames, clearance, entities } = data;

  const catBoxInstances = Array.from({ length: 8 }, () => []);
  const catSplineInstances = Array.from({ length: 8 }, () => []);

  for (let ei = 0; ei < entities.length; ei++) {
    const e = entities[ei];
    if (e.sp && e.sp.length >= 2) {
      for (let s = 0; s < e.sp.length - 1; s++) {
        catSplineInstances[e.cat].push({ ei, p1: e.sp[s], p2: e.sp[s + 1] });
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

    // Splines
    const splineInsts = catSplineInstances[cat];
    if (splineInsts.length > 0) {
      const catColor = isCbp ? CBP_COLOR : new THREE.Color(CAT_COLORS[cat]);
      const mesh = createDisplayMesh(cylGeom, catColor, splineInsts.length, cat, splineOpacity);
      color.copy(catColor);
      for (let j = 0; j < splineInsts.length; j++) {
        const { ei, p1, p2 } = splineInsts[j];
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
  buildMeshes(data, displayMeshes, 'save');
}

export function buildCbpScene(data) {
  cbpEntityData = data;
  clearMeshes(cbpMeshes);
  buildMeshes(data, cbpMeshes, 'cbp');
}
