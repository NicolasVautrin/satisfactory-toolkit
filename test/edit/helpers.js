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

/**
 * Assert that a list of stations are connected in a loop via track connections.
 * BFS through the track graph, enforcing that all integrated tracks (stations/docks)
 * are traversed in the same direction (all TC0→TC1 or all TC1→TC0).
 * @param {number[]} stationIndices - entity indices of the stations
 * @param {string} [label]
 */
function assertTrackLoop(stationIndices, label = '') {
  const prefix = label ? `${label}: ` : '';
  const saveState = getSaveState();
  const allObjects = saveState.allObjects;

  // Index by instanceName for O(1) lookups
  const byName = new Map();
  for (const o of allObjects) if (o.instanceName) byName.set(o.instanceName, o);

  // Get the integrated track instanceName for a station
  function getIntegratedTrack(idx) {
    return saveState.items[idx].entity.properties?.mRailroadTrack?.value?.pathName;
  }

  // Collect all integrated track instanceNames (stations + docks in the save)
  const integratedTracks = new Set();
  for (const o of allObjects) {
    if (o.typePath?.includes('RailroadTrackIntegrated')) integratedTracks.add(o.instanceName);
  }

  function sibling(portPath) {
    return portPath.endsWith('TrackConnection0')
      ? portPath.replace(/TrackConnection0$/, 'TrackConnection1')
      : portPath.replace(/TrackConnection1$/, 'TrackConnection0');
  }

  function parentEntity(portPath) {
    return portPath.replace(/\.TrackConnection[01]$/, '');
  }

  function isIntegrated(portPath) {
    return integratedTracks.has(parentEntity(portPath));
  }

  // direction: 0 = TC0→TC1, 1 = TC1→TC0
  function traversalDir(enterPort) {
    return enterPort.endsWith('TrackConnection0') ? 0 : 1;
  }

  // BFS from startPort, return set of reached integrated track instanceNames
  // integratedDir: null (not yet fixed) or 0/1
  // Returns { reached: Set<integratedTrackName>, success: boolean }
  function bfs(startPort) {
    const visited = new Set();
    const reached = new Set(); // integrated track instanceNames reached
    // queue items: portPath we ENTER the track from
    const queue = [startPort];
    let fixedDir = null;

    while (queue.length > 0) {
      const enterPort = queue.shift();
      if (visited.has(enterPort)) continue;
      visited.add(enterPort);

      const entity = parentEntity(enterPort);

      // If this is an integrated track, check direction constraint
      if (isIntegrated(enterPort)) {
        const dir = traversalDir(enterPort);
        if (fixedDir === null) {
          fixedDir = dir;
        } else if (dir !== fixedDir) {
          continue; // wrong direction — don't traverse this path
        }
        reached.add(entity);
      }

      // Exit via sibling port
      const exitPort = sibling(enterPort);
      visited.add(exitPort);

      // Follow connections from the exit port
      const exitComp = byName.get(exitPort);
      if (!exitComp) continue;
      const conns = exitComp.properties?.mConnectedComponents?.values || [];
      for (const c of conns) {
        if (!visited.has(c.pathName)) queue.push(c.pathName);
      }
    }

    return reached;
  }

  // Get station integrated tracks
  const stationTracks = stationIndices.map(idx => getIntegratedTrack(idx));

  // Try BFS from both TC0 and TC1 of the first station
  let allReached = false;
  for (const startSuffix of ['TrackConnection0', 'TrackConnection1']) {
    const startPort = `${stationTracks[0]}.${startSuffix}`;
    const reached = bfs(startPort);
    if (stationTracks.every(t => reached.has(t))) {
      allReached = true;
      break;
    }
  }

  assert(allReached,
    `${prefix}no valid loop found — not all stations reachable with consistent integrated track direction`);
}

module.exports = { assertApprox, getEntity, getBuilder, splineMidpoint, assertPortsAligned, assertLiftTopCardinal, assertConnected, added, assertTrackLoop };
