const Builder = require('./Builder');
const Vector3D = require('./Vector3D');
const Quaternion = require('./Quaternion');

/**
 * Base class for entities that snap onto spline endpoints:
 * ConveyorSplitter, ConveyorMerger, PipeJunction, PipePump.
 *
 * isSnappable: anchor must be IS_SPLINE + no other port already connected.
 * snapPorts: repositions entity so the snapped port aligns with the anchor.
 */
class SnapBuilder extends Builder {
  isSnappable(srcPort, anchorPort) {
    if (!anchorPort._owner?.constructor?.IS_SPLINE) return false;
    for (const p of Object.values(this._ports)) {
      if (p !== srcPort && p.isConnected) return false;
    }
    return true;
  }

  snapPorts(srcPort, anchorPort) {
    super.snapPorts(srcPort, anchorPort);

    const wPos = anchorPort.worldPos();
    const wDir = anchorPort.worldDir();
    const layout = this.constructor.PORT_LAYOUT;
    if (!layout) return;

    const portName = Object.entries(this._ports).find(([, p]) => p === srcPort)?.[0];
    const portDef = layout[portName];
    if (!portDef) return;

    // Rotate entity so the port's local dir opposes the anchor's world dir
    const wOpposed = { x: -wDir.x, y: -wDir.y };
    const rotation = Quaternion.fromLocalToWorldZ(portDef.dir, wOpposed).toPlain();
    this.entity.transform.rotation = rotation;

    // Compute entity position: wPos - rotated local offset
    const wOffset = new Vector3D(portDef.offset).rotate(rotation);
    this.entity.transform.translation = {
      x: wPos.x - wOffset.x,
      y: wPos.y - wOffset.y,
      z: wPos.z - (wOffset.z || 0),
    };
  }
}

module.exports = SnapBuilder;
