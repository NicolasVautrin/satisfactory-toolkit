/**
 * Clearance overlap detection using Oriented Bounding Boxes (OBB).
 * Uses Separating Axis Theorem (SAT) on 15 axes for full 3D OBB vs OBB.
 */
const Vector3D = require('./Vector3D');
const clearanceData = require('../../data/clearanceData.json');

/**
 * Build world-space OBBs for an entity.
 * @param {object} entity   SaveEntity with transform and typePath
 * @param {object} [boxes]  Override boxes (e.g. ConveyorLift.buildBoxes result)
 * @returns {Array<{center: Vector3D, halfExtents: Vector3D, axes: Vector3D[]}>}
 */
function getWorldOBBs(entity, boxes) {
  const cls = entity.typePath.split('.').pop();
  const boxDefs = boxes || clearanceData[cls]?.boxes;
  if (!boxDefs || boxDefs.length === 0) return [];

  const pos = new Vector3D(entity.transform.translation);
  const rot = entity.transform.rotation;

  return boxDefs.map(box => {
    // Local center = midpoint + relative transform offset
    const cx = (box.min.x + box.max.x) / 2 + (box.rt?.x || box.relativeTransform?.translation?.x || 0);
    const cy = (box.min.y + box.max.y) / 2 + (box.rt?.y || box.relativeTransform?.translation?.y || 0);
    const cz = (box.min.z + box.max.z) / 2 + (box.rt?.z || box.relativeTransform?.translation?.z || 0);

    // Half extents (always positive)
    const hx = (box.max.x - box.min.x) / 2;
    const hy = (box.max.y - box.min.y) / 2;
    const hz = (box.max.z - box.min.z) / 2;

    // Compose entity rotation with box-local rotation if present
    const boxRot = box.relativeTransform?.rotation;
    const finalRot = boxRot ? Vector3D.quatMul(rot, boxRot) : rot;

    // World center = entity pos + rotate(localCenter, entityRot)
    const worldCenter = pos.add(new Vector3D(cx, cy, cz).rotate(rot));

    // OBB axes = the 3 local axes rotated by finalRot
    const axes = [
      new Vector3D(1, 0, 0).rotate(finalRot),
      new Vector3D(0, 1, 0).rotate(finalRot),
      new Vector3D(0, 0, 1).rotate(finalRot),
    ];

    return { center: worldCenter, halfExtents: new Vector3D(hx, hy, hz), axes };
  });
}

/**
 * Bounding sphere radius for an entity's clearance (max distance from entity center to any box corner).
 * Used for fast pre-filtering before OBB tests.
 */
function boundingSphereRadius(entity, boxes) {
  const cls = entity.typePath.split('.').pop();
  const boxDefs = boxes || clearanceData[cls]?.boxes;
  if (!boxDefs || boxDefs.length === 0) return 0;

  let maxR = 0;
  for (const box of boxDefs) {
    const cx = (box.min.x + box.max.x) / 2 + (box.rt?.x || box.relativeTransform?.translation?.x || 0);
    const cy = (box.min.y + box.max.y) / 2 + (box.rt?.y || box.relativeTransform?.translation?.y || 0);
    const cz = (box.min.z + box.max.z) / 2 + (box.rt?.z || box.relativeTransform?.translation?.z || 0);
    const hx = (box.max.x - box.min.x) / 2;
    const hy = (box.max.y - box.min.y) / 2;
    const hz = (box.max.z - box.min.z) / 2;
    // Distance from entity origin to farthest corner of the box
    const r = Math.sqrt((Math.abs(cx) + hx) ** 2 + (Math.abs(cy) + hy) ** 2 + (Math.abs(cz) + hz) ** 2);
    if (r > maxR) maxR = r;
  }
  return maxR;
}

/**
 * Test overlap between two OBBs using Separating Axis Theorem.
 * @returns {boolean} true if overlapping
 */
function obbOverlap(a, b) {
  const d = b.center.sub(a.center);
  const aAxes = a.axes;
  const bAxes = b.axes;
  const aH = a.halfExtents;
  const bH = b.halfExtents;
  const aHArr = [aH.x, aH.y, aH.z];
  const bHArr = [bH.x, bH.y, bH.z];

  // Precompute dot products between axes
  const R = [[], [], []]; // R[i][j] = dot(aAxes[i], bAxes[j])
  const absR = [[], [], []];
  const EPSILON = 1e-6;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      R[i][j] = aAxes[i].dot(bAxes[j]);
      absR[i][j] = Math.abs(R[i][j]) + EPSILON;
    }
  }

  // Test 3 axes of A
  for (let i = 0; i < 3; i++) {
    const ra = aHArr[i];
    const rb = bHArr[0] * absR[i][0] + bHArr[1] * absR[i][1] + bHArr[2] * absR[i][2];
    if (Math.abs(d.dot(aAxes[i])) > ra + rb) return false;
  }

  // Test 3 axes of B
  for (let j = 0; j < 3; j++) {
    const ra = aHArr[0] * absR[0][j] + aHArr[1] * absR[1][j] + aHArr[2] * absR[2][j];
    const rb = bHArr[j];
    if (Math.abs(d.dot(bAxes[j])) > ra + rb) return false;
  }

  // Test 9 cross product axes (A[i] × B[j])
  // A0 × B0
  let ra = aHArr[1] * absR[2][0] + aHArr[2] * absR[1][0];
  let rb = bHArr[1] * absR[0][2] + bHArr[2] * absR[0][1];
  if (Math.abs(d.dot(aAxes[2]) * R[1][0] - d.dot(aAxes[1]) * R[2][0]) > ra + rb) return false;

  // A0 × B1
  ra = aHArr[1] * absR[2][1] + aHArr[2] * absR[1][1];
  rb = bHArr[0] * absR[0][2] + bHArr[2] * absR[0][0];
  if (Math.abs(d.dot(aAxes[2]) * R[1][1] - d.dot(aAxes[1]) * R[2][1]) > ra + rb) return false;

  // A0 × B2
  ra = aHArr[1] * absR[2][2] + aHArr[2] * absR[1][2];
  rb = bHArr[0] * absR[0][1] + bHArr[1] * absR[0][0];
  if (Math.abs(d.dot(aAxes[2]) * R[1][2] - d.dot(aAxes[1]) * R[2][2]) > ra + rb) return false;

  // A1 × B0
  ra = aHArr[0] * absR[2][0] + aHArr[2] * absR[0][0];
  rb = bHArr[1] * absR[1][2] + bHArr[2] * absR[1][1];
  if (Math.abs(d.dot(aAxes[0]) * R[2][0] - d.dot(aAxes[2]) * R[0][0]) > ra + rb) return false;

  // A1 × B1
  ra = aHArr[0] * absR[2][1] + aHArr[2] * absR[0][1];
  rb = bHArr[0] * absR[1][2] + bHArr[2] * absR[1][0];
  if (Math.abs(d.dot(aAxes[0]) * R[2][1] - d.dot(aAxes[2]) * R[0][1]) > ra + rb) return false;

  // A1 × B2
  ra = aHArr[0] * absR[2][2] + aHArr[2] * absR[0][2];
  rb = bHArr[0] * absR[1][1] + bHArr[1] * absR[1][0];
  if (Math.abs(d.dot(aAxes[0]) * R[2][2] - d.dot(aAxes[2]) * R[0][2]) > ra + rb) return false;

  // A2 × B0
  ra = aHArr[0] * absR[1][0] + aHArr[1] * absR[0][0];
  rb = bHArr[1] * absR[2][2] + bHArr[2] * absR[2][1];
  if (Math.abs(d.dot(aAxes[1]) * R[0][0] - d.dot(aAxes[0]) * R[1][0]) > ra + rb) return false;

  // A2 × B1
  ra = aHArr[0] * absR[1][1] + aHArr[1] * absR[0][1];
  rb = bHArr[0] * absR[2][2] + bHArr[2] * absR[2][0];
  if (Math.abs(d.dot(aAxes[1]) * R[0][1] - d.dot(aAxes[0]) * R[1][1]) > ra + rb) return false;

  // A2 × B2
  ra = aHArr[0] * absR[1][2] + aHArr[1] * absR[0][2];
  rb = bHArr[0] * absR[2][1] + bHArr[1] * absR[2][0];
  if (Math.abs(d.dot(aAxes[1]) * R[0][2] - d.dot(aAxes[0]) * R[1][2]) > ra + rb) return false;

  return true; // No separating axis found → overlap
}

/**
 * Check clearance overlaps for a set of new entities.
 *
 * Phase 1: intra-batch overlaps (new entities against each other)
 * Phase 2: batch vs map (new entities against existing save entities)
 *
 * @param {Array<{id: string, entity: object, boxes?: object[]}>} batchEntities
 * @param {object} saveState  Current save state (items[], entityData)
 * @param {Set<number>} excludeIndices  Indices of existing entities referenced in the batch (aliases)
 * @returns {Array<{a: string, aClass: string, b: string, bClass: string, source: string}>} collisions
 */
function checkClearance(batchEntities, saveState, excludeIndices) {
  const collisions = [];

  // Build OBBs for batch entities (skip those without clearance)
  const batchOBBs = batchEntities.map(be => {
    const obbs = getWorldOBBs(be.entity, be.boxes);
    return { ...be, obbs };
  }).filter(be => be.obbs.length > 0);

  // Phase 1: intra-batch
  for (let i = 0; i < batchOBBs.length; i++) {
    for (let j = i + 1; j < batchOBBs.length; j++) {
      const a = batchOBBs[i];
      const b = batchOBBs[j];
      if (anyOBBOverlap(a.obbs, b.obbs)) {
        collisions.push({
          a: a.id, aClass: a.entity.typePath.split('.').pop(),
          b: b.id, bClass: b.entity.typePath.split('.').pop(),
          source: 'intra-batch',
        });
      }
    }
  }

  // Phase 2: batch vs map
  if (saveState?.items && batchOBBs.length > 0) {
    // Compute batch bounding sphere
    let batchCenter = new Vector3D(0, 0, 0);
    for (const be of batchOBBs) batchCenter = batchCenter.add(new Vector3D(be.entity.transform.translation));
    batchCenter = batchCenter.scale(1 / batchOBBs.length);

    let batchRadius = 0;
    for (const be of batchOBBs) {
      const d = new Vector3D(be.entity.transform.translation).sub(batchCenter).length;
      const r = d + boundingSphereRadius(be.entity, be.boxes);
      if (r > batchRadius) batchRadius = r;
    }

    // Scan map entities
    const Registry = require('../../lib/Registry');
    const registry = Registry.default();

    for (let idx = 0; idx < saveState.items.length; idx++) {
      if (excludeIndices.has(idx)) continue;
      const item = saveState.items[idx];
      if (!item || item.type !== 'entity') continue;
      const entity = item.entity;
      const cls = entity.typePath.split('.').pop();

      // Skip spline entities
      const Builder = registry.get(cls);
      if (Builder?.IS_SPLINE) continue;

      // Quick distance check
      const dist = new Vector3D(entity.transform.translation).sub(batchCenter).length;
      const mapR = boundingSphereRadius(entity);
      if (dist > batchRadius + mapR) continue;

      // Full OBB check
      const mapOBBs = getWorldOBBs(entity);
      if (mapOBBs.length === 0) continue;

      for (const be of batchOBBs) {
        if (anyOBBOverlap(be.obbs, mapOBBs)) {
          collisions.push({
            a: be.id, aClass: be.entity.typePath.split('.').pop(),
            b: `index ${idx}`, bClass: cls,
            source: 'map',
          });
        }
      }
    }
  }

  return collisions;
}

/**
 * Test if any OBB from set A overlaps any OBB from set B.
 */
function anyOBBOverlap(obbsA, obbsB) {
  for (const a of obbsA) {
    for (const b of obbsB) {
      if (obbOverlap(a, b)) return true;
    }
  }
  return false;
}

/**
 * Format collision list into a readable error message.
 */
function formatCollisions(collisions) {
  const lines = collisions.map(c =>
    `  - "${c.a}" (${c.aClass}) overlaps "${c.b}" (${c.bClass}) [${c.source}]`
  );
  return `Clearance overlap detected:\n${lines.join('\n')}`;
}

module.exports = { getWorldOBBs, obbOverlap, checkClearance, formatCollisions, boundingSphereRadius };
