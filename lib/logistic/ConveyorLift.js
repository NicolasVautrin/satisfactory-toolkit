const {
  ref, FlowPort, PortType, makeCustomizationData, makeRecipeProp,
  makeEntity, makeComponent, makeSnappedPassthroughs,
  nextId, findComp,
  Vector3D, FlowType,
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
const ATTACH_DIST = 400;

// Quaternion multiply for Z-only rotations (x=0, y=0)
function quatMulZ(a, b) {
  return {
    x: 0, y: 0,
    z: a.w * b.z + a.z * b.w,
    w: a.w * b.w - a.z * b.z,
  };
}

// Direction vector (assuming local forward = -Y) -> Z-axis quaternion
function quatFromDirZ(dir) {
  const angle = Math.atan2(-dir.x, dir.y);
  return { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) };
}

// 180° Z quaternion
const ROT_180Z = { x: 0, y: 0, z: 1, w: 0 };

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
    const top = new Vector3D(translation).add(topOffset);

    // Port direction: -Y in local space
    const bottomDir = new Vector3D(0, -1, 0).rotateZ(rotation);
    // Top port: apply topRot (relative to entity rotation) to get opposing direction
    const topRotVal = entity.properties?.mTopTransform?.value?.properties?.Rotation?.value || { x: 0, y: 0, z: 0, w: 1 };
    const composed = quatMulZ(rotation, topRotVal);
    const topDir = new Vector3D(0, -1, 0).rotateZ(composed);

    // bottom and top ports
    const bottom = new FlowPort(comp0, translation, bottomDir);
    bottom.portType = PortType.BELT;
    bottom._owner = this;
    bottom._portName = 'bottom';
    bottom.flowType = null;

    const topPort = new FlowPort(comp1, top, topDir);
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
   * Update position of a port. The lift is always vertical so XY is shared.
   * @param portName  'bottom' or 'top'
   * @param pos       {x,y,z}
   */
  setPosition(portName, pos) {
    const bottom = this._ports[ConveyorLift.Ports.BOTTOM];
    const top = this._ports[ConveyorLift.Ports.TOP];
    const topTranslation = this.entity.properties.mTopTransform.value.properties.Translation.value;
    if (portName === 'bottom') {
      this.entity.transform.translation = { ...pos };
      bottom.pos = { ...pos };
      top.pos = { x: pos.x, y: pos.y, z: pos.z + topTranslation.z };
    } else {
      const bottomZ = pos.z - topTranslation.z;
      this.entity.transform.translation = { x: pos.x, y: pos.y, z: bottomZ };
      bottom.pos = { x: pos.x, y: pos.y, z: bottomZ };
      top.pos = { ...pos };
    }
  }

  /**
   * Update the direction a port faces. Sets entity rotation or topRot accordingly.
   * @param portName  'bottom' or 'top'
   * @param dir       Direction vector (world-space XY)
   */
  setPortDir(portName, dir) {
    const bottom = this._ports[ConveyorLift.Ports.BOTTOM];
    const top = this._ports[ConveyorLift.Ports.TOP];
    const rot = quatFromDirZ(dir);
    if (portName === 'bottom') {
      this.entity.transform.rotation = rot;
      bottom.dir = { x: dir.x, y: dir.y, z: 0 };
      const topRotVal = this.entity.properties.mTopTransform.value.properties.Rotation.value;
      top.dir = new Vector3D(0, -1, 0).rotateZ(quatMulZ(rot, topRotVal));
    } else {
      const entityRot = this.entity.transform.rotation;
      const invEntity = { x: 0, y: 0, z: -entityRot.z, w: entityRot.w };
      this.entity.properties.mTopTransform.value.properties.Rotation.value = quatMulZ(invEntity, rot);
      top.dir = { x: dir.x, y: dir.y, z: 0 };
    }
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
    port.attach(beltConn);
    // Resolve connType from the attached belt
    if (beltConn.flowType) {
      port.flowType = beltConn.flowType === FlowType.OUTPUT ? FlowType.INPUT : FlowType.OUTPUT;
      other.flowType = port.flowType === FlowType.INPUT ? FlowType.OUTPUT : FlowType.INPUT;
    }
  }

  /**
   * Attach a conveyor lift to a port.
   * Positions the attached lift 400u in the direction of this port,
   * with opposing rotation so ports face each other.
   * @param portName  'bottom' or 'top'
   * @param liftConn  ConnTarget from another ConveyorLift endpoint
   */
  attachLift(portName, liftConn) {
    const port = this._ports[portName];
    if (!port) throw new Error(`ConveyorLift ${this.inst}: unknown port "${portName}"`);
    const otherLift = liftConn._owner;
    if (!otherLift) throw new Error('attachLift requires a ConveyorLift ConnTarget');

    const newPos = new Vector3D(port.pos).add({ x: port.dir.x * ATTACH_DIST, y: port.dir.y * ATTACH_DIST, z: 0 });
    const opposedDir = { x: -port.dir.x, y: -port.dir.y, z: 0 };

    otherLift.setPosition(liftConn._portName, newPos);
    otherLift.setPortDir(liftConn._portName, opposedDir);

    // Propagate connType between lifts
    if (port.flowType) {
      liftConn.flowType = port.flowType === FlowType.OUTPUT ? FlowType.INPUT : FlowType.OUTPUT;
      const otherEndName = liftConn._portName === 'bottom' ? ConveyorLift.Ports.TOP : ConveyorLift.Ports.BOTTOM;
      const otherEnd = otherLift._ports[otherEndName];
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
}

ConveyorLift.Ports = { BOTTOM: 'bottom', TOP: 'top' };
ConveyorLift.TIERS = TIERS;

module.exports = ConveyorLift;
