const assert = require('assert');
const { getSaveState } = require('../../viewer/lib/saveManager');
const { getEntity: editorGetEntity } = require('../../viewer/lib/editor');

function assertApprox(a, b, tol = 1, msg) {
  assert(Math.abs(a - b) < tol, msg || `Expected ~${b}, got ${a}`);
}

function getEntity(index) {
  return getSaveState().items[index];
}

/** Get a Builder instance for an entity (with ports, fromSave) */
function getBuilder(index) {
  return editorGetEntity(index);
}

/** Compute belt/pipe midpoint from spline data */
function splineMidpoint(entity) {
  const start = entity.transform.translation;
  const spline = entity.properties.mSplineData.values;
  const endPt = spline[spline.length - 1].value?.properties?.Location?.value;
  return {
    x: start.x + (endPt?.x || 0) / 2,
    y: start.y + (endPt?.y || 0) / 2,
    z: start.z + (endPt?.z || 0) / 2,
  };
}

/** Verify two connected ports are co-located and opposed in world space
 * @param {object} portA
 * @param {object} portB
 * @param {string} [label]
 * @param {object} [opts]
 * @param {boolean} [opts.checkDir=true] - set false for lift↔lift (arms not necessarily opposed)
 */
function assertPortsAligned(portA, portB, label = '', { checkDir = true } = {}) {
  const prefix = label ? `${label}: ` : '';
  const wA = portA.worldPos();
  const wB = portB.worldPos();
  assertApprox(wA.x, wB.x, 2, `${prefix}worldPos.x mismatch (${wA.x} vs ${wB.x})`);
  assertApprox(wA.y, wB.y, 2, `${prefix}worldPos.y mismatch (${wA.y} vs ${wB.y})`);
  assertApprox(wA.z, wB.z, 2, `${prefix}worldPos.z mismatch (${wA.z} vs ${wB.z})`);
  if (checkDir) {
    const dA = portA.worldDir();
    const dB = portB.worldDir();
    if (dA && dB) {
      const dot = dA.x * dB.x + dA.y * dB.y + (dA.z || 0) * (dB.z || 0);
      assert(dot < -0.9, `${prefix}dirs should oppose (dot=${dot.toFixed(3)})`);
    }
  }
}

/** Verify lift top arm is cardinal in entity-local space */
function assertLiftTopCardinal(liftBuilder) {
  const entity = liftBuilder.entity;
  const topRotVal = entity.properties?.mTopTransform?.value?.properties?.Rotation?.value;
  assert(topRotVal, 'Lift should have mTopTransform.Rotation');
  // Top arm direction in entity-local: topRot applied to {1,0,0}
  const fwdX = topRotVal.w * topRotVal.w - topRotVal.z * topRotVal.z;
  const fwdY = 2 * topRotVal.w * topRotVal.z;
  // One component should be ≈ ±1, the other ≈ 0
  assert(
    (Math.abs(Math.abs(fwdX) - 1) < 0.1 && Math.abs(fwdY) < 0.1) ||
    (Math.abs(fwdX) < 0.1 && Math.abs(Math.abs(fwdY) - 1) < 0.1),
    `Top arm should be cardinal, got (${fwdX.toFixed(3)}, ${fwdY.toFixed(3)})`
  );
}

/** Get Builder for an added entity by id */
function added(result, id) {
  const entry = result.added.find(a => a.id === id);
  assert(entry, `Entity "${id}" not found in added`);
  return getBuilder(entry.index);
}

/** Assert port is connected and wired to the expected target port */
function assertConnected(builder, portName, targetBuilder, targetPortName, label = '') {
  const prefix = label ? `${label}: ` : '';
  const port = builder.port(portName);
  assert(port.isConnected, `${prefix}${portName} should be connected`);
  const targetPort = targetBuilder.port(targetPortName);
  assert.strictEqual(port._wiredTo?.pathName, targetPort.pathName,
    `${prefix}${portName} should be wired to ${targetPortName} (got ${port._wiredTo?.pathName})`);
}

module.exports = { assertApprox, getEntity, getBuilder, splineMidpoint, assertPortsAligned, assertLiftTopCardinal, assertConnected, added };
