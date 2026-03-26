import * as THREE from 'three';
import { scene, gameToViewer, requestRender } from './scene.js';

// ── Placement state ─────────────────────────────────────────
let active = false;
let rawCbpData = null; // original blueprint entityData (local coords)
let transform = { tx: 0, ty: 0, tz: 0, yaw: 0 }; // Unreal coords, yaw in degrees
let onUpdate = null; // callback(transformedData) when placement changes
let onConfirm = null; // callback() on Enter
let onCancel = null; // callback() on Escape
let axesGroup = null;
let bboxGroup = null;
let localBounds = null; // { xMin, xMax, yMin, yMax, zMin, zMax } in blueprint local space

const STEP_NORMAL = 100;
const STEP_FINE = 10;
const STEP_GRID = 800;
const ROT_NORMAL = 15;
const ROT_FINE = 1;
const ROT_GRID = 90;

export function isPlacementActive() { return active; }
export function getTransform() { return { ...transform }; }

export function startPlacement(cbpData, initialPos, { onMove, onConfirm: confirmCb, onCancel: cancelCb }) {
  rawCbpData = cbpData;
  transform = { tx: initialPos.x, ty: initialPos.y, tz: initialPos.z, yaw: 0 };
  onUpdate = onMove;
  onConfirm = confirmCb;
  onCancel = cancelCb;
  active = true;
  buildAxes();
  applyTransform();
}

export function stopPlacement() {
  active = false;
  rawCbpData = null;
  localBounds = null;
  onUpdate = null;
  onConfirm = null;
  onCancel = null;
  removeAxes();
  removeBboxGrid();
}

// ── Apply transform to blueprint data and notify ────────────
function applyTransform() {
  if (!rawCbpData || !onUpdate) return;

  const cosY = Math.cos(transform.yaw * Math.PI / 180);
  const sinY = Math.sin(transform.yaw * Math.PI / 180);

  // Build transformed entity data
  const transformed = {
    classNames: rawCbpData.classNames,
    clearance: rawCbpData.clearance,
    portLayouts: rawCbpData.portLayouts,
    entities: rawCbpData.entities.map(e => {
      // Rotate local position around Z by yaw, then translate
      const rx = e.tx * cosY - e.ty * sinY;
      const ry = e.tx * sinY + e.ty * cosY;

      // Compose entity quaternion with yaw rotation
      // yaw quat = (0, 0, sin(yaw/2), cos(yaw/2))
      const halfYaw = (transform.yaw * Math.PI / 180) / 2;
      const yqz = Math.sin(halfYaw);
      const yqw = Math.cos(halfYaw);
      // q_result = q_yaw * q_entity
      const nrx = yqw * e.rx + yqz * e.ry;
      const nry = yqw * e.ry - yqz * e.rx;
      const nrz = yqw * e.rz + yqz * e.rw;
      const nrw = yqw * e.rw - yqz * e.rz;

      const result = {
        ...e,
        tx: rx + transform.tx,
        ty: ry + transform.ty,
        tz: e.tz + transform.tz,
        rx: nrx, ry: nry, rz: nrz, rw: nrw,
      };

      // Transform spline points
      if (e.sp) {
        result.sp = e.sp.map(p => {
          const px = p[0] * cosY - p[1] * sinY + transform.tx;
          const py = p[0] * sinY + p[1] * cosY + transform.ty;
          return [px, py, p[2] + transform.tz];
        });
      }

      // Transform lift points
      if (e.lift) {
        result.lift = e.lift.map(p => {
          const px = p[0] * cosY - p[1] * sinY + transform.tx;
          const py = p[0] * sinY + p[1] * cosY + transform.ty;
          return [px, py, p[2] + transform.tz];
        });
      }

      return result;
    }),
  };

  updateAxes();
  updateBboxGrid();
  onUpdate(transformed);
}

// ── Keyboard handler ────────────────────────────────────────
export function handleKey(e) {
  if (!active) return false;

  const shift = e.shiftKey;
  const ctrl = e.ctrlKey;
  const step = ctrl ? STEP_GRID : shift ? STEP_FINE : STEP_NORMAL;
  const rotStep = ctrl ? ROT_GRID : shift ? ROT_FINE : ROT_NORMAL;

  const key = e.key.toLowerCase();
  switch (key) {
    case 'q': transform.tx -= step; break;
    case 'd': transform.tx += step; break;
    case 'z': transform.ty -= step; break;
    case 's': transform.ty += step; break;
    case 'r': transform.tz += step; break;
    case 'f': transform.tz -= step; break;
    case 'a': transform.yaw -= rotStep; break;
    case 'e': transform.yaw += rotStep; break;
    case 'enter': if (onConfirm) onConfirm(); return true;
    case 'escape': if (onCancel) onCancel(); return true;
    default: return false;
  }

  applyTransform();
  return true;
}

// ── 3D Axes at centroid ─────────────────────────────────────
const AXIS_LENGTH = 2000;
const AXIS_THICKNESS = 3;

function buildAxes() {
  removeAxes();
  axesGroup = new THREE.Group();

  const materials = [
    new THREE.LineBasicMaterial({ color: 0xff0000, linewidth: AXIS_THICKNESS }), // X = red
    new THREE.LineBasicMaterial({ color: 0x00ff00, linewidth: AXIS_THICKNESS }), // Y = green
    new THREE.LineBasicMaterial({ color: 0x4488ff, linewidth: AXIS_THICKNESS }), // Z = blue
  ];

  // X axis (Unreal X → viewer -X)
  const xGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-AXIS_LENGTH, 0, 0),
    new THREE.Vector3(AXIS_LENGTH, 0, 0),
  ]);
  axesGroup.add(new THREE.Line(xGeom, materials[0]));

  // Y axis (Unreal Y → viewer Y)
  const yGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -AXIS_LENGTH, 0),
    new THREE.Vector3(0, AXIS_LENGTH, 0),
  ]);
  axesGroup.add(new THREE.Line(yGeom, materials[1]));

  // Z axis (Unreal Z → viewer Z)
  const zGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, -AXIS_LENGTH),
    new THREE.Vector3(0, 0, AXIS_LENGTH),
  ]);
  axesGroup.add(new THREE.Line(zGeom, materials[2]));

  scene.add(axesGroup);
}

function updateAxes() {
  if (!axesGroup) return;
  const pos = gameToViewer(transform.tx, transform.ty, transform.tz);
  axesGroup.position.copy(pos);
  // Yaw in Unreal = rotation around Z. In viewer space, Z is up, but X is flipped.
  // Unreal yaw quaternion (0,0,sin(y/2),cos(y/2)) → viewer: (0,0,-sin(y/2),cos(y/2))
  const halfYaw = (transform.yaw * Math.PI / 180) / 2;
  axesGroup.quaternion.set(0, 0, -Math.sin(halfYaw), Math.cos(halfYaw));
}

function removeAxes() {
  if (axesGroup) {
    scene.remove(axesGroup);
    axesGroup = null;
  }
}

// ── Bounding box grid ───────────────────────────────────────
const BBOX_GRID_COLOR = 0x888888;
const BBOX_EDGE_COLOR = 0xffaa00;

function buildBboxGrid() {
  removeBboxGrid();
  if (!localBounds) return;

  bboxGroup = new THREE.Group();
  const { xMin, xMax, yMin, yMax, zMin, zMax } = localBounds;
  const G = STEP_GRID;

  const gridPts = [];
  const edgePts = [];

  function gv(x, y, z) {
    const v = gameToViewer(x, y, z);
    return { x: v.x, y: v.y, z: v.z };
  }

  function pushLine(arr, a, b) {
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  // Lines parallel to X at each (y, z)
  for (let y = yMin; y <= yMax; y += G) {
    for (let z = zMin; z <= zMax; z += G) {
      const isEdge = (y === yMin || y === yMax) || (z === zMin || z === zMax);
      pushLine(isEdge ? edgePts : gridPts, gv(xMin, y, z), gv(xMax, y, z));
    }
  }

  // Lines parallel to Y at each (x, z)
  for (let x = xMin; x <= xMax; x += G) {
    for (let z = zMin; z <= zMax; z += G) {
      const isEdge = (x === xMin || x === xMax) || (z === zMin || z === zMax);
      pushLine(isEdge ? edgePts : gridPts, gv(x, yMin, z), gv(x, yMax, z));
    }
  }

  // Lines parallel to Z at each (x, y)
  for (let x = xMin; x <= xMax; x += G) {
    for (let y = yMin; y <= yMax; y += G) {
      const isEdge = (x === xMin || x === xMax) || (y === yMin || y === yMax);
      pushLine(isEdge ? edgePts : gridPts, gv(x, y, zMin), gv(x, y, zMax));
    }
  }

  function addBatch(pts, color, opacity) {
    if (pts.length === 0) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
    bboxGroup.add(new THREE.LineSegments(geom, mat));
  }

  addBatch(gridPts, BBOX_GRID_COLOR, 0.1);
  addBatch(edgePts, BBOX_EDGE_COLOR, 0.3);

  scene.add(bboxGroup);
}

function rebuildBboxBounds() {
  // Recompute world-aligned bounding box from rotated entities, centered on centroid
  if (!rawCbpData || rawCbpData.entities.length === 0) { localBounds = null; return; }

  const cosY = Math.cos(transform.yaw * Math.PI / 180);
  const sinY = Math.sin(transform.yaw * Math.PI / 180);
  const G = STEP_GRID;
  const cx = transform.tx, cy = transform.ty, cz = transform.tz;

  // Find extent relative to centroid
  let dxMin = Infinity, dxMax = -Infinity, dyMin = Infinity, dyMax = -Infinity, dzMin = Infinity, dzMax = -Infinity;
  for (const e of rawCbpData.entities) {
    const dx = e.tx * cosY - e.ty * sinY;
    const dy = e.tx * sinY + e.ty * cosY;
    const dz = e.tz;
    if (dx < dxMin) dxMin = dx; if (dx > dxMax) dxMax = dx;
    if (dy < dyMin) dyMin = dy; if (dy > dyMax) dyMax = dy;
    if (dz < dzMin) dzMin = dz; if (dz > dzMax) dzMax = dz;
  }

  // Snap outward from centroid in grid steps
  localBounds = {
    xMin: cx + Math.floor(dxMin / G) * G - G,
    xMax: cx + Math.ceil(dxMax / G) * G + G,
    yMin: cy + Math.floor(dyMin / G) * G - G,
    yMax: cy + Math.ceil(dyMax / G) * G + G,
    zMin: cz + Math.floor(dzMin / G) * G - G,
    zMax: cz + Math.ceil(dzMax / G) * G + G,
  };
}

function updateBboxGrid() {
  rebuildBboxBounds();
  buildBboxGrid();
}

function removeBboxGrid() {
  if (bboxGroup) {
    scene.remove(bboxGroup);
    bboxGroup = null;
  }
}
