const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makeSnappedPassthroughs,
  nextId, findComp,
  Vector3D, FlowType, Quaternion,
} = require('../../satisfactoryLib');
const Builder = require('../shared/Builder');

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

// Local axis for lift ports — both offset and direction are along the arm (+X local)
const PORT_DIR_AXIS = { x: 1, y: 0 };

// 180° Z quaternion
const ROT_180Z = { x: 0, y: 0, z: 1, w: 0 };

// 4 cardinal directions in local space
const CARDINALS = [
  { x: 1, y: 0 }, { x: -1, y: 0 },
  { x: 0, y: 1 }, { x: 0, y: -1 },
];

/**
 * Deduce flowType from the name of a connected component.
 * Belt ports are polarized: ConveyorAny0 = input, ConveyorAny1 = output.
 * Producer/splitter/merger ports are named Input* / Output*.
 * @param {string} shortName  Last segment of the connected component path
 * @returns {string|null}  FlowType for our port (opposite of the connected port), or null
 */
function flowTypeFromConnectedName(shortName) {
  if (/^Output/i.test(shortName) || shortName === 'ConveyorAny1') return FlowType.INPUT;
  if (/^Input/i.test(shortName) || shortName === 'ConveyorAny0') return FlowType.OUTPUT;
  return null;
}

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

class ConveyorLift extends Builder {
  /**
   * @param entity  SaveEntity for the lift
   * @param comp0   ConveyorAny0 component (bottom)
   * @param comp1   ConveyorAny1 component (top)
   */
  constructor(entity, comp0, comp1) {
    super(entity, comp0, comp1);

    // Both ports have the same local offset/dir relative to their respective transforms
    // portTransform() returns the right transform for each port
    const bottom = new FlowPort(comp0, { x: ATTACH_DIST, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
    bottom.portType = PortType.BELT;
    bottom._owner = this;
    bottom._portName = 'bottom';
    bottom.flowType = null;

    const topPort = new FlowPort(comp1, { x: ATTACH_DIST, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
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

  /**
   * Return the transform for a port.
   * Bottom port: entity transform.
   * Top port: composed entity * mTopTransform.
   */
  portTransform(port) {
    if (port === this._ports[ConveyorLift.Ports.TOP]) {
      return this._composedTopTransform();
    }
    return this.entity.transform;
  }

  /**
   * Compose entity transform with mTopTransform to get top port's world transform.
   */
  _composedTopTransform() {
    const { translation, rotation } = this.entity.transform;
    const topTrans = this.entity.properties?.mTopTransform?.value?.properties?.Translation?.value || { x: 0, y: 0, z: 0 };
    const topRotVal = this.entity.properties?.mTopTransform?.value?.properties?.Rotation?.value || { x: 0, y: 0, z: 0, w: 1 };
    const composedRot = quatMulZ(rotation, topRotVal);
    // Top translation in world = entity pos + topTrans (topTrans is in entity-local but only has Z for lifts)
    return {
      translation: { x: translation.x, y: translation.y, z: translation.z + (topTrans.z || 0) },
      rotation: composedRot,
    };
  }

  /**
   * Set the top arm direction in entity-local space.
   * Updates mTopTransform.Rotation. worldPos()/worldDir() of the top port auto-recalculate.
   * @param {{x,y}} lDir  Desired top arm direction in entity-local space (e.g. {1,0} = same as bottom)
   */
  _setTopDir(lDir) {
    // lDir is the desired +X axis direction for the top arm in entity-local space
    // topRot maps local +X to lDir
    const topRot = Quaternion.fromLocalToWorldZ(PORT_DIR_AXIS, lDir).toPlain();
    const topProps = this.entity.properties.mTopTransform.value.properties;
    if (topProps.Rotation) {
      topProps.Rotation.value = topRot;
    } else {
      topProps.Rotation = {
        type: 'StructProperty', ueType: 'StructProperty',
        name: 'Rotation', value: topRot, subtype: 'Quat',
      };
    }
  }

  /**
   * Reposition the lift after a port has been snapped.
   * @param {FlowPort} snappedPort - the port that was snapped
   * @param {{x,y,z}} wPos - world position from the anchor
   * @param {{x,y,z}} wDir - world direction from the anchor
   */
  onPortSnapped(snappedPort, wPos, wDir) {
    const portName = snappedPort === this._ports[ConveyorLift.Ports.BOTTOM] ? 'bottom' : 'top';
    const otherName = portName === 'bottom' ? ConveyorLift.Ports.TOP : ConveyorLift.Ports.BOTTOM;
    const otherConnected = this._ports[otherName].isConnected;

    // Bottom snap with top already connected → cannot move the whole entity
    if (portName === 'bottom' && otherConnected) {
      throw new Error(`Cannot reposition ConveyorLift: port ${otherName} already connected`);
    }

    const wOpposed = { x: -wDir.x, y: -wDir.y };

    // Top snap with bottom already connected → adjust height + reorient arm only
    if (portName === 'top' && otherConnected) {
      const entZ = this.entity.transform.translation.z;
      this.entity.properties.mTopTransform.value.properties.Translation.value.z = wPos.z - entZ;
      // Convert world opposed dir to entity-local for setTopDir
      const invEntRot = { x: 0, y: 0, z: -this.entity.transform.rotation.z, w: this.entity.transform.rotation.w };
      const lOpposed = new Vector3D(wOpposed.x, wOpposed.y, 0).rotateZ(invEntRot);
      this._setTopDir({ x: lOpposed.x, y: lOpposed.y });
      return;
    }

    // Full reposition (no port connected yet)
    // Rotate entity so bottom port opposes the anchor direction
    const rot = Quaternion.fromLocalToWorldZ(PORT_DIR_AXIS, wOpposed).toPlain();
    this.entity.transform.rotation = rot;

    // Position entity so the port lands on wPos
    const wOffset = new Vector3D(ATTACH_DIST, 0, 0).rotateZ(rot);
    this.entity.transform.translation = {
      x: wPos.x - wOffset.x,
      y: wPos.y - wOffset.y,
      z: wPos.z,
    };
  }

  /**
   * Attach a conveyor belt ConnTarget to a port.
   * @param portName  'bottom' or 'top'
   * @param beltConn  ConnTarget from a ConveyorBelt endpoint
   */
  attachBelt(portName, beltPort) {
    const port = this._ports[portName];
    if (!port) throw new Error(`ConveyorLift ${this.inst}: unknown port "${portName}"`);
    const otherName = portName === 'bottom' ? ConveyorLift.Ports.TOP : ConveyorLift.Ports.BOTTOM;
    const other = this._ports[otherName];

    // Get belt port world info
    const wBeltPos = beltPort.worldPos();
    const wBeltDir = beltPort.worldDir();
    const wOpposed = { x: -wBeltDir.x, y: -wBeltDir.y };

    if (portName === 'bottom') {
      // Rotate entity so bottom port opposes the belt direction
      const rot = Quaternion.fromLocalToWorldZ(PORT_DIR_AXIS, wOpposed).toPlain();
      this.entity.transform.rotation = rot;
      // Position entity so port lands on belt pos
      const wOffset = new Vector3D(ATTACH_DIST, 0, 0).rotateZ(rot);
      this.entity.transform.translation = {
        x: wBeltPos.x - wOffset.x,
        y: wBeltPos.y - wOffset.y,
        z: wBeltPos.z,
      };
    } else {
      // Top snap: adjust height + reorient top arm
      const entZ = this.entity.transform.translation.z;
      this.entity.properties.mTopTransform.value.properties.Translation.value.z = wBeltPos.z - entZ;
      const invEntRot = { x: 0, y: 0, z: -this.entity.transform.rotation.z, w: this.entity.transform.rotation.w };
      const lOpposed = new Vector3D(wOpposed.x, wOpposed.y, 0).rotateZ(invEntRot);
      this._setTopDir({ x: lOpposed.x, y: lOpposed.y });
    }

    // Wire without snap (no belt spline recalculation)
    port.wire(beltPort);

    // Resolve flowTypes
    if (beltPort.flowType) {
      port.flowType = beltPort.flowType === FlowType.OUTPUT ? FlowType.INPUT : FlowType.OUTPUT;
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
      // Use toLift's current top port world direction
      // fromLift's bottom port dir must oppose toLift's top port dir
      const topPortDir = toLift._ports[ConveyorLift.Ports.TOP].worldDir();
      const wOpposed = { x: -topPortDir.x, y: -topPortDir.y };

      // Rotate fromLift's entity so its bottom port dir = wOpposed
      const rot = Quaternion.fromLocalToWorldZ(PORT_DIR_AXIS, wOpposed).toPlain();
      fromLift.entity.transform.rotation = rot;

      // Position fromLift so its bottom port lands on toLift's top port
      const wTopPos = toLift._ports[ConveyorLift.Ports.TOP].worldPos();
      const wOffset = new Vector3D(ATTACH_DIST, 0, 0).rotateZ(rot);
      fromLift.entity.transform.translation = {
        x: wTopPos.x - wOffset.x,
        y: wTopPos.y - wOffset.y,
        z: wTopPos.z,
      };
    } else {
      // Case 2: top↔top — toLift's top direction is FIXED, fromLift adapts
      // fromLift's top port dir must oppose toLift's top port dir
      const toTopPortDir = toLift._ports[ConveyorLift.Ports.TOP].worldDir();
      const wOpposed = { x: -toTopPortDir.x, y: -toTopPortDir.y };

      // Convert desired port dir to fromLift's entity-local space (= arm dir now)
      const fromRot = fromLift.entity.transform.rotation;
      const invFromRot = { x: 0, y: 0, z: -fromRot.z, w: fromRot.w };
      const lDir = new Vector3D(wOpposed.x, wOpposed.y, 0).rotateZ(invFromRot);

      // Must be cardinal
      const isCardinal =
        (Math.abs(Math.abs(lDir.x) - 1) < 0.1 && Math.abs(lDir.y) < 0.1) ||
        (Math.abs(lDir.x) < 0.1 && Math.abs(Math.abs(lDir.y) - 1) < 0.1);
      if (!isCardinal) {
        throw new Error(
          'Cannot connect lift top↔top: opposed direction is not cardinal in from-lift local space. ' +
          'Reposition the lifts so their tops can face each other.'
        );
      }

      fromLift._setTopDir({ x: lDir.x, y: lDir.y });
    }

    // Validate flow compatibility before wiring
    if (port.flowType && liftConn.flowType && port.flowType === liftConn.flowType) {
      throw new Error(`Incompatible connection: both ports are ${port.flowType}`);
    }

    // Propagate flow types (only if the from-lift isn't already polarized)
    if (port.flowType && !liftConn.flowType) {
      liftConn.flowType = port.flowType === FlowType.OUTPUT ? FlowType.INPUT : FlowType.OUTPUT;
      const otherEndName = fromPortName === 'bottom' ? ConveyorLift.Ports.TOP : ConveyorLift.Ports.BOTTOM;
      const otherEnd = fromLift._ports[otherEndName];
      if (!otherEnd.flowType) {
        otherEnd.flowType = liftConn.flowType === FlowType.INPUT ? FlowType.OUTPUT : FlowType.INPUT;
      }
    }

    port.wire(liftConn);
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

    const topTransformProps = {
      Translation: {
        type: 'StructProperty', ueType: 'StructProperty',
        name: 'Translation', value: { x: 0, y: 0, z: height }, subtype: 'Vector',
      },
      Rotation: {
        type: 'StructProperty', ueType: 'StructProperty',
        name: 'Rotation', value: topRot, subtype: 'Quat',
      },
    };

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
    const comp0 = findComp(saveObjects, `${inst}.ConveyorAny0`);
    const comp1 = findComp(saveObjects, `${inst}.ConveyorAny1`);
    const lift = new ConveyorLift(entity, comp0, comp1);

    // Restore flowTypes from connected component names.
    // Belt ports are polarized (ConveyorAny0=input, ConveyorAny1=output),
    // producer/splitter/merger ports are named Input*/Output*.
    const comps = [comp0, comp1];
    const ports = [lift._ports[ConveyorLift.Ports.BOTTOM], lift._ports[ConveyorLift.Ports.TOP]];
    for (let i = 0; i < 2; i++) {
      const connPath = comps[i]?.properties?.mConnectedComponent?.value?.pathName;
      if (!connPath) continue;
      const flow = flowTypeFromConnectedName(connPath.split('.').pop());
      if (flow) {
        ports[i].flowType = flow;
        ports[1 - i].flowType = flow === FlowType.INPUT ? FlowType.OUTPUT : FlowType.INPUT;
        break;
      }
    }

    return lift;
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
    // Top arm direction in entity-local space (cardinal: ±X or ±Y)
    const topFwdX = topRotVal.w * topRotVal.w - topRotVal.z * topRotVal.z;
    const topFwdY = 2 * topRotVal.w * topRotVal.z;
    // Build AABB for the top arm along its cardinal direction
    const isXDir = Math.abs(topFwdX) > Math.abs(topFwdY);
    let topMin, topMax;
    if (isXDir) {
      topMin = { x: topFwdX > 0 ? 0 : -200, y: -50, z: -50 };
      topMax = { x: topFwdX > 0 ? 200 : 0, y: 50, z: 50 };
    } else {
      topMin = { x: -50, y: topFwdY > 0 ? 0 : -200, z: -50 };
      topMax = { x: 50, y: topFwdY > 0 ? 200 : 0, z: 50 };
    }
    return [
      { min: { x: -15, y: -15, z: minZ }, max: { x: 15, y: 15, z: maxZ } },
      // Bottom beam: always +X local (entity forward)
      { min: { x: 0, y: -50, z: -50 }, max: { x: 200, y: 50, z: 50 } },
      // Top beam: aligned with top arm cardinal direction
      { min: topMin, max: topMax, rt: { x: topTrans.x, y: topTrans.y, z: topTrans.z } },
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
ConveyorLift.TopDir = {
  FRONT: { x: 1, y: 0 },
  BACK:  { x: -1, y: 0 },
  RIGHT: { x: 0, y: 1 },
  LEFT:  { x: 0, y: -1 },
};
ConveyorLift.TIERS = TIERS;
ConveyorLift.IS_SPLINE = true;
ConveyorLift.SNAP_BEHAVIOR = 'Snap cardinal uniquement (±X, ±Y).';

ConveyorLift.getPorts = function(entity) {
  const layout = ConveyorLift.buildPortsLayout(entity);
  if (!layout) return null;
  const t = entity.transform.translation;
  const r = entity.transform.rotation;
  return {
    ports: layout.map(p => {
      const offset = new Vector3D(p.ox, p.oy, p.oz);
      const dir = new Vector3D(p.dx, p.dy, p.dz);
      const pos = offset.rotate(r).add(new Vector3D(t));
      const worldDir = dir.rotate(r);
      return { name: p.n, pos, dir: worldDir, flow: null, type: 'belt' };
    }),
    splineLength: null,
  };
};

ConveyorLift.wikiPage = function(opts) {
  const page = Builder.wikiPage.call(this, opts);
  page.portType = 'belt';
  page.layout = {
    description: 'Shaft vertical centré sur la position de l\'entité, avec deux bras horizontaux indépendants.',
    center: 'Position de l\'entité (transform.translation). Le shaft monte de z=0 à z=mTopTransform.Translation.z.',
    bottomArm: {
      direction: '+X local de l\'entité (entity.transform.rotation). Toujours cardinal (±X, ±Y monde).',
      portOffset: `${ATTACH_DIST} UU depuis le centre, le long du bras.`,
      snap: 'Snap bottom → l\'entité entière tourne et se repositionne pour aligner le port.',
    },
    topArm: {
      direction: 'Rotation indépendante via mTopTransform.Rotation (relative à l\'entité). Peut pointer dans une autre direction cardinale que le bottom.',
      portOffset: `${ATTACH_DIST} UU depuis le sommet du shaft, le long du bras.`,
      snap: 'Snap top → seul mTopTransform.Rotation change, l\'entité ne bouge pas.',
    },
    liftToLift: {
      bottomToTop: 'Le from-lift (libre) se repositionne : bottom arm opposé au top arm du to-lift.',
      topToTop: 'Les deux lifts sont ancrés : seuls les topTransforms tournent pour se faire face. Les bras doivent s\'opposer.',
    },
  };
  page.polarization = {
    description: 'Les ports bottom/top sont bidirectionnels à la création (flowType = null). La première connexion à un port polarisé fixe la direction du flux.',
    rules: [
      'Connecté à un Output (ou ConveyorAny1) → ce port devient INPUT, l\'autre OUTPUT',
      'Connecté à un Input (ou ConveyorAny0) → ce port devient OUTPUT, l\'autre INPUT',
      'Deux lifts top↔top ne peuvent se connecter que si leurs polarités sont opposées',
    ],
  };
  return page;
};

module.exports = ConveyorLift;
