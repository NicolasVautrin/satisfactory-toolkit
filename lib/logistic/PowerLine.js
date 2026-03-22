const {
  ref, makeEntity, nextId, TYPE_PATHS, Vector3D,
} = require('../../satisfactoryLib');

class PowerLine {
  static create(from, to) {
    const id = nextId();
    const baseName = `Build_PowerLine_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const entity = makeEntity(TYPE_PATHS.powerLine, inst);
    entity.needTransform = true;
    entity.transform = {
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      translation: new Vector3D(from.pos).add(to.pos).scale(0.5),
      scale3d: { x: 1, y: 1, z: 1 },
    };
    entity.components = [];
    entity.properties = {
      mWireInstances: {
        type: 'StructArrayProperty', ueType: 'ArrayProperty',
        name: 'mWireInstances',
        structValueFields: { allStructType: 'WireInstance' },
        subtype: 'StructProperty',
        values: [{
          type: 'StructProperty', ueType: 'StructProperty', name: '',
          subtype: 'WireInstance',
          value: {
            type: 'WireInstance',
            properties: {
              Locations: [
                { type: 'StructProperty', ueType: 'StructProperty', name: 'Locations', value: from.pos, subtype: 'Vector' },
                { type: 'StructProperty', ueType: 'StructProperty', name: 'Locations', index: 1, value: to.pos, subtype: 'Vector' },
              ],
            },
          },
        }],
      },
    };
    entity.specialProperties = {
      type: 'PowerLineSpecialProperties',
      source: ref(from.pathName),
      target: ref(to.pathName),
    };
    return { entity, inst, components: [], allObjects: () => [entity] };
  }

  static fromBlueprint(entity, blueprintTransform) {
    const Transform = require('../shared/Transform');
    const worldTransform = blueprintTransform.apply(Transform.fromSave(entity.transform));
    const id = nextId();
    const baseName = `Build_PowerLine_C_${id}`;
    const inst = `Persistent_Level:PersistentLevel.${baseName}`;

    const clone = makeEntity(TYPE_PATHS.powerLine, inst);
    clone.needTransform = true;
    clone.transform = worldTransform.toSave();
    clone.components = [];
    clone.properties = JSON.parse(JSON.stringify(entity.properties || {}));
    clone.specialProperties = { type: 'PowerLineSpecialProperties', source: ref(''), target: ref('') };
    return { entity: clone, inst, components: [], allObjects: () => [clone] };
  }
}

module.exports = PowerLine;