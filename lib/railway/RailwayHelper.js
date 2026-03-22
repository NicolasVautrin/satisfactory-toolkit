const { ref, Vector3D } = require('../../satisfactoryLib');

// All train platforms share the same integrated track layout
const TRACK_LOCAL_OFFSET = { x: 800, y: 0, z: 0 };
const TRACK_LENGTH       = 1600;

/**
 * Multiply two quaternions: q1 * q2.
 */
function mulQuat(q1, q2) {
  return {
    w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
    x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
    y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
    z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
  };
}

// 180° around Z: half-angle = 90°, sin(90°) = 1, cos(90°) = 0
const ROT_180_Z = { x: 0, y: 0, z: 1, w: 0 };

/**
 * Reposition a platform at a given world position and rotation.
 * Updates the platform's transform and rebuilds its integrated track.
 * @param platform  Platform object (TrainStation, BeltStation, PipeStation, etc.)
 * @param pos       World position (Vector3D) for the platform center
 * @param rot       Quaternion rotation to apply
 */
function reposition(platform, pos, rot) {
  platform.entity.transform.rotation    = { ...rot };
  platform.entity.transform.translation = { x: pos.x, y: pos.y, z: pos.z };

  if (platform.track) {
    const trackPos = pos.add(new Vector3D(TRACK_LOCAL_OFFSET).rotate(rot));
    const trackDir = new Vector3D(-1, 0, 0).rotate(rot);
    const trackEnd = trackPos.add(trackDir.scale(TRACK_LENGTH));

    platform.track._ports.TrackConnection0.pos = trackPos;
    platform.track._ports.TrackConnection0.dir = trackDir;
    platform.track._ports.TrackConnection1.pos = trackEnd;
    platform.track._ports.TrackConnection1.dir = trackDir;
    platform.track.recalcSpline();
  }
}

/**
 * Dock another platform to a source platform's side.
 * Positions and rotates the target, rebuilds its integrated track,
 * connects tracks and platform connections.
 *
 * When srcSide === tgtSide (e.g. two backs facing each other), the target
 * is rotated 180° automatically.
 *
 * @param source   The reference platform (already positioned)
 * @param srcSide  0 (back, +X local) or 1 (front, -X local) on source
 * @param target   The platform to dock
 * @param tgtSide  0 or 1 on target (default: opposite of srcSide)
 */
function dock(source, srcSide, target, tgtSide) {
  if (tgtSide === undefined) tgtSide = srcSide === 0 ? 1 : 0;
  const flip = srcSide === tgtSide;

  const srcBox = source.clearance.boxes[0];
  const tgtBox = target.clearance.boxes[0];
  const offset = srcSide === 0
    ? srcBox.max.x + (flip ? tgtBox.max.x : -tgtBox.min.x)
    : srcBox.min.x - (flip ? tgtBox.min.x :  tgtBox.max.x);

  const srcRot = source.entity.transform.rotation;
  const tgtRot = flip ? mulQuat(srcRot, ROT_180_Z) : { ...srcRot };
  const pos    = new Vector3D(source.entity.transform.translation);
  const localX = new Vector3D(1, 0, 0).rotate(srcRot);

  reposition(target, pos.add(localX.scale(offset)), tgtRot);

  // Connect tracks
  if (source.track && target.track) {
    const srcPort = `TrackConnection${srcSide}`;
    const tgtPort = `TrackConnection${tgtSide}`;
    source.track.connect(srcPort, target.track, tgtPort);
  }

  // Connect platform connections
  const srcComp = source._componentMap[`PlatformConnection${srcSide}`];
  const tgtComp = target._componentMap[`PlatformConnection${tgtSide}`];
  srcComp.properties.mConnectedTo = {
    type: 'ObjectProperty', ueType: 'ObjectProperty',
    name: 'mConnectedTo', value: ref(tgtComp.instanceName),
  };
  tgtComp.properties.mConnectedTo = {
    type: 'ObjectProperty', ueType: 'ObjectProperty',
    name: 'mConnectedTo', value: ref(srcComp.instanceName),
  };
}

module.exports = { reposition, dock };
