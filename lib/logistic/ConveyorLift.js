const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makeSnappedPassthroughs,
  nextId, findComp,
  Vector3D, FlowType, Quaternion,
} = require('../../satisfactoryLib');

const TIERS = {
  1: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorLiftMk1/Build_ConveyorLiftMk1.Build_ConveyorLiftMk1_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorLiftMk1.Recipe_ConveyorLiftMk1_C',
  },
  2: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorLiftMk2/Build_ConveyorLiftMk2.Build_ConveyorLiftMk2_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorLiftMk2.Recipe_ConveyorLiftMk2_C',
  },
  3: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorLiftMk3/Build_ConveyorLiftMk3.Build_ConveyorLiftMk3_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorLiftMk3.Recipe_ConveyorLiftMk3_C',
  },
  4: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorLiftMk4/Build_ConveyorLiftMk4.Build_ConveyorLiftMk4_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorLiftMk4.Recipe_ConveyorLiftMk4_C',
  },
  5: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorLiftMk5/Build_ConveyorLiftMk5.Build_ConveyorLiftMk5_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorLiftMk5.Recipe_ConveyorLiftMk5_C',
  },
  6: {
    typePath: '/Game/FactoryGame/Buildable/Factory/ConveyorLiftMk6/Build_ConveyorLiftMk6.Build_ConveyorLiftMk6_C',
    recipe: '/Game/FactoryGame/Recipes/Buildings/Recipe_ConveyorLiftMk6.Recipe_ConveyorLiftMk6_C',
  },
};

const FLAGS_CONVEYOR_CONN = 262152;
const ATTACH_DIST = 300;

// Quaternion multiply for Z-only rotations (x=0, y=0)
function quatMulZ(a, b) {
  return {
    x: 0, y: 0,
    z: a.w * b.z + a.z * b.w,
    w: a.w * b.w - a.z * b.z,
  };
}

// Local axes for lift ports
const PORT_OFFSET_AXIS = { x: 1, y: 0 };  // port offset is in +X local
const PORT_DIR_AXIS = { x: 0, y: -1 };    // port direction is -Y local

// 180° Z quaternion
const ROT_180Z = { x: 0, y: 0, z: 1, w: 0 };

// 4 cardinal directions in local space
const CARDINALS = [
  { x: 1, y: 0 }, { x: -1, y: 0 },
  { x: 0, y: 1 }, { x: 0, y: -1 },
];

/**
 * Find the cardinal direction (local space of refEntity) that best matches
 * the direction from refPos toward targetPos.
 * @param {{x,y}} targetPos  position to point toward
 * @param {{x,y}} refPos     reference entity position
 * @param {{z,w}} refRot     reference entity Z-only rotation quaternion
 * @returns {{x,y}} best cardinal direction in local space
 */
function snapCardinalDir(targetPos, refPos, refRot) {
  const invRot = { x: 0, y: 0, z: -refRot.z, w: refRot.w };
  const relLocal = new Vector3D(targetPos.x - refPos.x, targetPos.y - refPos.y, 0).rotateZ(invRot);
  let bestDir = CARDINALS[0], bestDot = -Infinity;
  for (const c of CARDINALS) {
    const dot = relLocal.x * c.x + relLocal.y * c.y;
    if (dot > bestDot) { bestDot = dot; bestDir = c; }
  }
  return bestDir;
}

class ConveyorLift {
  /**
   * @param entity  SaveEntity for the lift
   * @param comp0   ConveyorAny0 component (bottom)
   * @param comp1   ConveyorAny1 component (top)
   */
  constructor(entity, comp0, comp1) {
    this.entity = entity;
    this.inst = entity.instanceName;

    const { translation, rotation } = entity.transform;
    const topOffset = entity.properties?.mTopTransform?.value?.properties?.Translation?.value || new Vector3D(0, 0, 0);
    const topBase = new Vector3D(translation).add(topOffset);

    // Port direction: -Y in local space
    const bottomDir = new Vector3D(0, -1, 0).rotateZ(rotation);
    const topRotVal = entity.properties?.mTopTransform?.value?.properties?.Rotation?.value || { x: 0, y: 0, z: 0, w: 1 };
    const composed = quatMulZ(rotation, topRotVal);
    const topDir = new Vector3D(0, -1, 0).rotateZ(composed);

    // Port positions: offset ATTACH_DIST (400) in forward direction (+X local)
    const bottomPortPos = new Vector3D(translation).add(new Vector3D(ATTACH_DIST, 0, 0).rotateZ(rotation));
    const topPortPos = new Vector3D(topBase).add(new Vector3D(ATTACH_DIST, 0, 0).rotateZ(composed));

    // bottom and top ports
    const bottom = new FlowPort(comp0, bottomPortPos, bottomDir);
    bottom.portType = PortType.BELT;
    bottom._owner = this;
    bottom._portName = 'bottom';
    bottom.flowType = null;

    const topPort = new FlowPort(comp1, topPortPos, topDir);
    topPort.portType = PortType.BELT;
    topPort._owner = this;
    topPort._portName = 'top';
    topPort.flowType = null;

    this._ports = {
      [ConveyorLift.Ports.BOTTOM]: bottom,
      [ConveyorLift.Ports.TOP]: topPort,
    };
    this.components = [comp0, comp1];
  }

  port(name) {
    const p = this._ports[name];
    if (!p) throw new Error(`ConveyorLift ${this.inst}: unknown port "${name}"`);
    return p;
  }

  /**
   * Reposition the lift after a port has been snapped.
   * Called by FlowPort.snapTo() — this port adapted to an anchor's position.
   * @param {FlowPort} snappedPort - the port whose pos/dir was just updated
   */
  onPortSnapped(snappedPort) {
    const portName = snappedPort === this._ports[ConveyorLift.Ports.BOTTOM] ? 'bottom' : 'top';
    const srcDir = snappedPort.dir;
    const opposedDir = { x: -srcDir.x, y: -srcDir.y };

    // Rotate so port flow direction (-Y local) faces opposite to the source port
    const rot = Quaternion.fromLocalToWorldZ(PORT_DIR_AXIS, opposedDir).toPlain();
    if (portName === 'bottom') {
      this.entity.transform.rotation = rot;
    }
    // Update port direction to oppose the snapped source
    snappedPort.dir = { x: opposedDir.x, y: opposedDir.y, z: 0 };
    this.setPosition(portName, snappedPort.pos);
  }

  /**
   * Update position of a port. Sets the entity position so the port
   * (offset ATTACH_DIST in forward direction) lands at the given pos.
   * @param portName  'bottom' or 'top'
   * @param pos       {x,y,z} — desired port position (where the connection is)
   */
  setPosition(portName, pos) {
    const bottom = this._ports[ConveyorLift.Ports.BOTTOM];
    const top = this._ports[ConveyorLift.Ports.TOP];
    const topTranslation = this.entity.properties.mTopTransform.value.properties.Translation.value;
    const rotation = this.entity.transform.rotation;
    const topRotVal = this.entity.properties?.mTopTransform?.value?.properties?.Rotation?.value || { x: 0, y: 0, z: 0, w: 1 };
    const composed = quatMulZ(rotation, topRotVal);

    // Forward offset for bottom/top
    const bottomFwd = new Vector3D(ATTACH_DIST, 0, 0).rotateZ(rotation);
    const topFwd = new Vector3D(ATTACH_DIST, 0, 0).rotateZ(composed);

    if (portName === 'bottom') {
      // Entity position = port position - forward offset
      const entPos = new Vector3D(pos).sub(bottomFwd);
      this.entity.transform.translation = { x: entPos.x, y: entPos.y, z: entPos.z };
      bottom.pos = { ...pos };
      top.pos = { x: entPos.x + topFwd.x, y: entPos.y + topFwd.y, z: entPos.z + topTranslation.z };
    } else {
      const entZ = pos.z - topTranslation.z;
      const entPos = new Vector3D(pos).sub(topFwd);
      entPos.z = entZ;
      this.entity.transform.translation = { x: entPos.x, y: entPos.y, z: entZ };
      bottom.pos = { x: entPos.x + bottomFwd.x, y: entPos.y + bottomFwd.y, z: entZ };
      top.pos = { ...pos };
    }
  }

  /**
   * Update the top port arm direction and recalculate port position.
   * Sets mTopTransform.Rotation so the top arm (+X local) points in armDir (world XY).
   * @param {{x,y}} armDir  Desired arm direction in world space
   */
  _setTopArm(armDir) {
    const top = this._ports[ConveyorLift.Ports.TOP];
    const { translation } = this.entity.transform;
    const entityQ = new Quaternion(this.entity.transform.rotation);
    const topHeight = this.entity.properties.mTopTransform.value.properties.Translation.value.z;

    // worldRot maps +X local → armDir world; topRot = entityRot⁻¹ · worldRot
    const worldQ = Quaternion.fromLocalToWorldZ(PORT_OFFSET_AXIS, armDir);
    const topRot = entityQ.inverse().multiply(worldQ).toPlain();

    const topProps = this.entity.properties.mTopTransform.value.properties;
    if (topProps.Rotation) {
      topProps.Rotation.value = topRot;
    } else {
      topProps.Rotation = {
        type: 'StructProperty', ueType: 'StructProperty',
        name: 'Rotation', value: topRot, subtype: 'Quat',
      };
    }

    // Recalculate top port position and direction
    const topFwd = worldQ.rotateVectorZ(new Vector3D(ATTACH_DIST, 0, 0));
    top.pos = { x: translation.x + topFwd.x, y: translation.y + topFwd.y, z: translation.z + topHeight };
    const topDir = worldQ.rotateVectorZ(new Vector3D(PORT_DIR_AXIS.x, PORT_DIR_AXIS.y, 0));
    top.dir = { x: topDir.x, y: topDir.y, z: 0 };
  }

  /**
   * Update the bottom (entity) rotation so the bottom arm points in armDir.
   * Recalculates both port positions.
   * @param {{x,y}} armDir  Desired arm direction in world space
   */
  _setBottomArm(armDir) {
    const bottom = this._ports[ConveyorLift.Ports.BOTTOM];
    const top = this._ports[ConveyorLift.Ports.TOP];
    const { translation } = this.entity.transform;
    const topHeight = this.entity.properties.mTopTransform.value.properties.Translation.value.z;

    const entityQ = Quaternion.fromLocalToWorldZ(PORT_OFFSET_AXIS, armDir);
    this.entity.transform.rotation = entityQ.toPlain();

    // Recalculate bottom port
    const bottomFwd = entityQ.rotateVectorZ(new Vector3D(ATTACH_DIST, 0, 0));
    bottom.pos = { x: translation.x + bottomFwd.x, y: translation.y + bottomFwd.y, z: translation.z };
    const bottomDir = entityQ.rotateVectorZ(new Vector3D(PORT_DIR_AXIS.x, PORT_DIR_AXIS.y, 0));
    bottom.dir = { x: bottomDir.x, y: bottomDir.y, z: 0 };

    // Recalculate top port (entity rotation changed, topRot unchanged)
    const topRotVal = this.entity.properties.mTopTransform?.value?.properties?.Rotation?.value || { x: 0, y: 0, z: 0, w: 1 };
    const composedQ = entityQ.multiply(new Quaternion(topRotVal));
    const topFwd = composedQ.rotateVectorZ(new Vector3D(ATTACH_DIST, 0, 0));
    top.pos = { x: translation.x + topFwd.x, y: translation.y + topFwd.y, z: translation.z + topHeight };
    const topDir = composedQ.rotateVectorZ(new Vector3D(PORT_DIR_AXIS.x, PORT_DIR_AXIS.y, 0));
    top.dir = { x: topDir.x, y: topDir.y, z: 0 };
  }

  /**
   * Attach a conveyor belt ConnTarget to a port.
   * @param portName  'bottom' or 'top'
   * @param beltConn  ConnTarget from a ConveyorBelt endpoint
   */
  attachBelt(portName, beltConn) {
    const port = this._ports[portName];
    if (!port) throw new Error(`ConveyorLift ${this.inst}: unknown port "${portName}"`);
    const otherName = portName === 'bottom' ? ConveyorLift.Ports.TOP : ConveyorLift.Ports.BOTTOM;
    const other = this._ports[otherName];
    beltConn.attach(port);
    // Resolve connType from the attached belt
    if (beltConn.flowType) {
      port.flowType = beltConn.flowType === FlowType.OUTPUT ? FlowType.INPUT : FlowType.OUTPUT;
      other.flowType = port.flowType === FlowType.INPUT ? FlowType.OUTPUT : FlowType.INPUT;
    }
  }

  /**
   * Attach another conveyor lift to this lift's top port.
   * `this` is the "to" lift (fixed, adapts topTransform).
   * `liftConn` is the FlowPort from the "from" lift.
   *
   * Two cases based on liftConn's port:
   * - bottom: the from-lift is free → reposition it so its bottom faces this lift's top
   * - top:    the from-lift is anchored → only rotate both topTransforms (error if cardinals don't oppose)
   *
   * @param portName  port on this lift (always 'top')
   * @param liftConn  FlowPort from the other ConveyorLift
   */
  attachLift(portName, liftConn) {
    const port = this._ports[portName];
    if (!port) throw new Error(`ConveyorLift ${this.inst}: unknown port "${portName}"`);
    const fromLift = liftConn._owner;
    if (!fromLift) throw new Error('attachLift requires a ConveyorLift FlowPort');
    const fromPortName = liftConn._portName;

    const toLift = this;
    const toRot = toLift.entity.transform.rotation;
    const toPos = toLift.entity.transform.translation;
    const fromPos = fromLift.entity.transform.translation;

    if (fromPortName === 'bottom') {
      // Case 1: from-lift is free — reposition entirely
      const localDir = snapCardinalDir(fromPos, toPos, toRot);
      const armDir = new Vector3D(localDir.x, localDir.y, 0).rotateZ(toRot);

      toLift._setTopArm(armDir);

      fromLift._setBottomArm({ x: -armDir.x, y: -armDir.y });
      fromLift.setPosition('bottom', toLift._ports[ConveyorLift.Ports.TOP].pos);
    } else {
      // Case 2: from-lift is anchored — rotate topTransforms only
      const localDirTo = snapCardinalDir(fromPos, toPos, toRot);
      const armDirTo = new Vector3D(localDirTo.x, localDirTo.y, 0).rotateZ(toRot);

      const fromRot = fromLift.entity.transform.rotation;
      const localDirFrom = snapCardinalDir(toPos, fromPos, fromRot);
      const armDirFrom = new Vector3D(localDirFrom.x, localDirFrom.y, 0).rotateZ(fromRot);

      // Validate: arm directions must oppose
      const dot = armDirTo.x * armDirFrom.x + armDirTo.y * armDirFrom.y;
      if (dot >= 0) {
        throw new Error(
          'Cannot connect lift top↔top: cardinal directions do not oppose. ' +
          'Reposition the lifts so their tops can face each other.'
        );
      }

      toLift._setTopArm(armDirTo);
      fromLift._setTopArm(armDirFrom);
    }

    // Propagate flow types
    if (port.flowType) {
      liftConn.flowType = port.flowType === FlowType.OUTPUT ? FlowType.INPUT : FlowType.OUTPUT;
      const otherEndName = fromPortName === 'bottom' ? ConveyorLift.Ports.TOP : ConveyorLift.Ports.BOTTOM;
      const otherEnd = fromLift._ports[otherEndName];
      otherEnd.flowType = liftConn.flowType === FlowType.INPUT ? FlowType.OUTPUT : FlowType.INPUT;
    }

    port.wire(liftConn);
  }

  /** Get all save objects (entity + components) to inject into save */
  allObjects() {
    return [this.entity, ...this.components];
  }

  /**
   * Create a new ConveyorLift.
   * @param bottomPos    {x,y,z} bottom position
   * @param height       Height in units (positive = up, negative = down)
   * @param bottomRot    Quaternion for bottom orientation (entity rotation)
   * @param topRot       Quaternion for top orientation (relative to bottom)
   * @param tier         Belt tier 1-6 (default 6)
   */
  static create(bottomPos, height, bottomRot = { x: 0, y: 0, z: 0, w: 1 }, topRot = { x: 0, y: 0, z: 0, w: 1 }, tier = 6) {
    const tierInfo = TIERS[tier];
    if (!tierInfo) throw new Error(`Invalid lift tier: ${tier}`);

    const id = nextId();
    const mkName = `ConveyorLiftMk${tier}`;
    const baseName = `Build_${mkName}_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(tierInfo.typePath, inst);
    entity.transform = {
      rotation: bottomRot,
      translation: { ...bottomPos },
      scale3d: { x: 1, y: 1, z: 1 },
    };

    const conn0Name = `${inst}.ConveyorAny0`;
    const conn1Name = `${inst}.ConveyorAny1`;
    entity.components = [ref(conn1Name), ref(conn0Name)];

    // Build mTopTransform — only include Rotation if non-identity
    const topTransformProps = {
      Translation: {
        type: 'StructProperty', ueType: 'StructProperty',
        name: 'Translation', value: { x: 0, y: 0, z: height }, subtype: 'Vector',
      },
    };

    const isIdentity = Math.abs(topRot.x) < 0.001 && Math.abs(topRot.y) < 0.001
      && Math.abs(topRot.z) < 0.001 && Math.abs(topRot.w - 1) < 0.001;
    if (!isIdentity) {
      topTransformProps.Rotation = {
        type: 'StructProperty', ueType: 'StructProperty',
        name: 'Rotation', value: topRot, subtype: 'Quat',
      };
    }

    entity.properties = {
      mTopTransform: {
        type: 'StructProperty', ueType: 'StructProperty',
        name: 'mTopTransform', subtype: 'Transform',
        value: { type: 'Transform', properties: topTransformProps },
      },
      mSnappedPassthroughs: makeSnappedPassthroughs(),
      mCustomizationData: makeCustomizationData(),
      mBuiltWithRecipe: makeRecipeProp(tierInfo.recipe),
    };
    entity.specialProperties = { type: 'ConveyorSpecialProperties' };

    const comp0 = makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', conn0Name, inst, FLAGS_CONVEYOR_CONN);
    const comp1 = makeComponent('/Script/FactoryGame.FGFactoryConnectionComponent', conn1Name, inst, FLAGS_CONVEYOR_CONN);

    return new ConveyorLift(entity, comp0, comp1);
  }

  static fromSave(entity, saveObjects) {
    const inst = entity.instanceName;
    return new ConveyorLift(entity,
      findComp(saveObjects, `${inst}.ConveyorAny0`),
      findComp(saveObjects, `${inst}.ConveyorAny1`),
    );
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const tier = entity.typePath.includes('Mk1') ? 1 : entity.typePath.includes('Mk2') ? 2
      : entity.typePath.includes('Mk3') ? 3 : entity.typePath.includes('Mk4') ? 4
      : entity.typePath.includes('Mk5') ? 5 : 6;
    // Use a dummy height, then overwrite mTopTransform with the original
    const lift = ConveyorLift.create(worldTransform.translation, 400, worldTransform.rotation, { x: 0, y: 0, z: 0, w: 1 }, tier);
    // Preserve original mTopTransform (local space, doesn't need rotation)
    if (entity.properties?.mTopTransform) {
      lift.entity.properties.mTopTransform = JSON.parse(JSON.stringify(entity.properties.mTopTransform));
    }
    return lift;
  }
  /**
   * Build clearance boxes in UE entity-local space.
   * Returns 3 boxes: vertical shaft (30×30) + 2 horizontal beams (100×100×200).
   * @param {object} entity  SaveEntity with mTopTransform
   * @returns {Array|null}  Array of {min,max,rt?} or null if no topTransform
   */
  static buildBoxes(entity) {
    const topTrans = entity.properties?.mTopTransform?.value?.properties?.Translation?.value;
    if (!topTrans) return null;
    const minZ = Math.min(0, topTrans.z);
    const maxZ = Math.max(0, topTrans.z);
    // Top beam direction in entity-local: topRot applied to (1,0,0)
    // For Z-only quats: fwdX = w²-z²
    const topRotVal = entity.properties?.mTopTransform?.value?.properties?.Rotation?.value || { x: 0, y: 0, z: 0, w: 1 };
    const topLocalFwdX = topRotVal.w * topRotVal.w - topRotVal.z * topRotVal.z;
    return [
      { min: { x: -15, y: -15, z: minZ }, max: { x: 15, y: 15, z: maxZ } },
      // Bottom beam: always +X local (entity forward)
      { min: { x: 0, y: -50, z: -50 }, max: { x: 200, y: 50, z: 50 } },
      // Top beam: topRot direction in entity-local
      { min: { x: topLocalFwdX >= 0 ? 0 : -200, y: -50, z: -50 },
        max: { x: topLocalFwdX >= 0 ? 200 : 0, y: 50, z: 50 },
        rt: { x: topTrans.x, y: topTrans.y, z: topTrans.z } },
    ];
  }
  /**
   * Build per-instance port layout in UE entity-local space.
   * @param {object} entity  SaveEntity with mTopTransform
   * @returns {Array|null}  Array of {n, ox,oy,oz, dx,dy,dz, flow, type} or null
   */
  static buildPortsLayout(entity) {
    const topTrans = entity.properties?.mTopTransform?.value?.properties?.Translation?.value;
    if (!topTrans) return null;
    const topRotVal = entity.properties?.mTopTransform?.value?.properties?.Rotation?.value || { x: 0, y: 0, z: 0, w: 1 };
    const w = topRotVal.w, z = topRotVal.z;
    const topFwdX = w * w - z * z;
    const topFwdY = 2 * w * z;
    return [
      { n: 'ConveyorAny0', ox: ATTACH_DIST, oy: 0, oz: 0, dx: 1, dy: 0, dz: 0, flow: -1, type: 0 },
      { n: 'ConveyorAny1',
        ox: topFwdX * ATTACH_DIST + topTrans.x, oy: topFwdY * ATTACH_DIST + topTrans.y, oz: topTrans.z,
        dx: topFwdX, dy: topFwdY, dz: 0, flow: -1, type: 0 },
    ];
  }
}

ConveyorLift.Ports = { BOTTOM: 'bottom', TOP: 'top' };
ConveyorLift.TIERS = TIERS;

module.exports = ConveyorLift;
