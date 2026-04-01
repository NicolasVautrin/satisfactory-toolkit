/**
 * Shared snap logic for splitter/merger/junction/pump attachments.
 * Rotates the entity so the snapped port opposes the anchor direction,
 * then repositions the entity so the port lands on the anchor position.
 *
 * @param {Builder} builder       The attachment builder (splitter, merger, etc.)
 * @param {FlowPort} port         The port that was snapped
 * @param {object} portOffsets    Map of port name → local offset {x,y,z}
 * @param {object} portDirs       Map of port name → local direction {x,y,z}
 * @param {{x,y,z}} wPos         World-space target position (from anchor)
 * @param {{x,y,z}} wDir         World-space target direction (from anchor)
 */
function snapAttachment(builder, port, portOffsets, portDirs, wPos, wDir) {
  const Vector3D = require('./Vector3D');
  const Quaternion = require('./Quaternion');

  // Guard: cannot reposition if another port is already connected
  for (const [name, p] of Object.entries(builder._ports)) {
    if (p !== port && p.isConnected) {
      throw new Error(`Cannot reposition ${builder.constructor.name}: port ${name} already connected`);
    }
  }

  const portName = Object.entries(builder._ports).find(([, p]) => p === port)?.[0];
  const lOffset = portOffsets[portName];
  if (!lOffset) return;

  // Rotate entity so the port's local dir opposes the anchor's world dir
  const lDir = portDirs[portName];
  const wOpposed = { x: -wDir.x, y: -wDir.y };
  const rotation = Quaternion.fromLocalToWorldZ(lDir, wOpposed).toPlain();
  builder.entity.transform.rotation = rotation;

  // Compute entity position: wPos - rotated local offset
  const wOffset = new Vector3D(lOffset).rotate(rotation);
  builder.entity.transform.translation = {
    x: wPos.x - wOffset.x,
    y: wPos.y - wOffset.y,
    z: wPos.z - (wOffset.z || 0),
  };
}

module.exports = snapAttachment;
