const { Parser } = require('@etothepii/satisfactory-file-parser');
const { initSession } = require('../../satisfactoryLib');
const { getSaveState, getCbpState } = require('./saveLoader');

// ── CBP v1.0 uses short type names, normalize to *Property format ──
const TYPE_ALIASES = {
  Struct: 'StructProperty', Array: 'ArrayProperty', Object: 'ObjectProperty',
  Float: 'FloatProperty', Int: 'IntProperty', Bool: 'BoolProperty',
  Byte: 'ByteProperty', Str: 'StrProperty', Text: 'TextProperty',
  SoftObject: 'SoftObjectProperty', Enum: 'EnumProperty', Name: 'NameProperty',
};

function inferCbpType(prop) {
  if (prop.type) return TYPE_ALIASES[prop.type] || prop.type;
  const v = prop.value;
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'object' && v.pathName !== undefined) return 'ObjectProperty';
  if (typeof v === 'object' && v.values !== undefined) return 'StructProperty';
  if (typeof v === 'number' && Number.isInteger(v)) return 'IntProperty';
  if (typeof v === 'number') return 'FloatProperty';
  if (typeof v === 'boolean') return 'BoolProperty';
  if (typeof v === 'string') return 'StrProperty';
  if (typeof v === 'object' && v.type !== undefined) return 'StructProperty';
  return undefined;
}

function convertCbpProperty(cbpProp) {
  const { name, value } = cbpProp;
  const type = inferCbpType(cbpProp);

  if (type === 'StructProperty') {
    if (value?.type === 'Vector' && value.values) {
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { x: value.values.x, y: value.values.y, z: value.values.z },
        subtype: 'Vector',
      };
    }
    if (value?.type === 'Rotator' && value.values) {
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { pitch: value.values.pitch, yaw: value.values.yaw, roll: value.values.roll },
        subtype: 'Rotator',
      };
    }
    if (value?.type === 'FactoryCustomizationData') {
      const props = {};
      for (const sub of (value.values || [])) {
        props[sub.name] = convertCbpProperty(sub);
      }
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { type: 'FactoryCustomizationData', properties: props },
        subtype: 'FactoryCustomizationData',
      };
    }
    if (value?.type === 'SplinePointData') {
      return cbpProp;
    }
    if (value?.values && !Array.isArray(value.values) && typeof value.values === 'object') {
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { ...value.values },
        subtype: value.type,
      };
    }
    if (Array.isArray(value?.values)) {
      const props = {};
      for (const sub of value.values) {
        props[sub.name] = convertCbpProperty(sub);
      }
      return {
        type: 'StructProperty', ueType: 'StructProperty', name,
        value: { type: value.type, properties: props },
        subtype: value.type,
      };
    }
    return { ...cbpProp, type: 'StructProperty', ueType: 'StructProperty' };
  }

  if (type === 'ObjectProperty') {
    return {
      type: 'ObjectProperty', ueType: 'ObjectProperty', name,
      value: { levelName: value?.levelName || '', pathName: value?.pathName || '' },
    };
  }

  if (type === 'ArrayProperty') {
    const valueType = TYPE_ALIASES[value?.type] || value?.type;
    if (valueType === 'ObjectProperty') {
      return {
        type: 'ObjectArrayProperty', ueType: 'ArrayProperty', name,
        subtype: 'ObjectProperty',
        values: (value.values || []).map(v => ({
          levelName: v?.levelName || '', pathName: v?.pathName || '',
        })),
      };
    }
    if (valueType === 'StructProperty') {
      const structSubType = cbpProp.structureSubType || 'Generic';
      const converted = (value.values || []).map(ptArray => {
        if (Array.isArray(ptArray)) {
          const props = {};
          for (const sub of ptArray) {
            props[sub.name] = convertCbpProperty(sub);
          }
          return {
            type: 'StructProperty', ueType: 'StructProperty', name: '',
            subtype: structSubType,
            value: { type: structSubType, properties: props },
          };
        }
        return ptArray;
      });
      const result = {
        type: 'StructArrayProperty', ueType: 'ArrayProperty', name,
        subtype: 'StructProperty',
        values: converted,
      };
      if (cbpProp.structureSubType) {
        result.structValueFields = { allStructType: cbpProp.structureSubType };
      }
      return result;
    }
    if (valueType && value?.values) {
      const arrayTypeMap = {
        IntProperty: 'Int32ArrayProperty',
        Int64Property: 'Int64ArrayProperty',
        FloatProperty: 'FloatArrayProperty',
        DoubleProperty: 'DoubleArrayProperty',
        ByteProperty: 'ByteArrayProperty',
        BoolProperty: 'BoolArrayProperty',
        StrProperty: 'StrArrayProperty',
        EnumProperty: 'EnumArrayProperty',
        SoftObjectProperty: 'SoftObjectArrayProperty',
        TextProperty: 'TextArrayProperty',
      };
      const arrayType = arrayTypeMap[valueType] || 'ArrayProperty';
      return {
        type: arrayType, ueType: 'ArrayProperty', name,
        subtype: valueType,
        values: value.values,
      };
    }
    return { ...cbpProp, type: 'ArrayProperty', ueType: 'ArrayProperty' };
  }

  if (type === 'FloatProperty') return { type, ueType: type, name, value };
  if (type === 'IntProperty') return { type, ueType: type, name, value };
  if (type === 'BoolProperty') return { type, ueType: type, name, value };
  if (type === 'ByteProperty') {
    const byteVal = (value && typeof value === 'object')
      ? { type: value.enumName || value.type || 'None', value: value.value }
      : { type: 'None', value: value || 0 };
    return { type, ueType: type, name, value: byteVal };
  }
  if (type === 'StrProperty') return { type, ueType: type, name, value };
  if (type === 'TextProperty') {
    const textValue = {};
    textValue.flags = cbpProp.flags !== undefined ? cbpProp.flags : 0;
    textValue.historyType = cbpProp.historyType !== undefined ? cbpProp.historyType : 255;
    if (cbpProp.hasCultureInvariantString !== undefined) textValue.hasCultureInvariantString = !!cbpProp.hasCultureInvariantString;
    if (cbpProp.value !== undefined && typeof cbpProp.value === 'string') textValue.value = cbpProp.value;
    if (cbpProp.namespace !== undefined) textValue.namespace = cbpProp.namespace;
    if (cbpProp.key !== undefined) textValue.key = cbpProp.key;
    if (cbpProp.sourceFmt !== undefined) textValue.sourceFmt = cbpProp.sourceFmt;
    if (cbpProp.arguments !== undefined) textValue.arguments = cbpProp.arguments;
    if (cbpProp.sourceText !== undefined) textValue.sourceText = cbpProp.sourceText;
    if (cbpProp.transformType !== undefined) textValue.transformType = cbpProp.transformType;
    if (cbpProp.tableId !== undefined) textValue.tableId = cbpProp.tableId;
    if (cbpProp.textKey !== undefined) textValue.textKey = cbpProp.textKey;
    return { type, ueType: type, name, value: textValue };
  }
  if (type === 'SoftObjectProperty') {
    const softVal = {
      pathName: value?.pathName || '',
      instanceName: value?.subPathString || value?.instanceName || '',
      unk: value?.unk || 0,
    };
    return { type, ueType: type, name, value: softVal };
  }
  if (type === 'EnumProperty') return { type, ueType: type, name, value };

  return { ...cbpProp, type, ueType: type };
}

function convertCbpProperties(propsArray) {
  const result = {};
  for (const prop of propsArray) {
    result[prop.name] = convertCbpProperty(prop);
  }
  return result;
}

// Deep-ensure all property-like objects have ueType set
function deepEnsureUeType(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) { obj.forEach(deepEnsureUeType); return obj; }

  if (obj.name !== undefined && obj.type && !obj.ueType) {
    const normalized = TYPE_ALIASES[obj.type] || obj.type;
    obj.type = normalized;
    obj.ueType = normalized;
  }
  if ((obj.type === 'StructProperty' || obj.ueType === 'StructProperty') && !obj.subtype) {
    obj.subtype = obj.value?.type || 'Generic';
  }
  if ((obj.type === 'ObjectProperty' || obj.ueType === 'ObjectProperty') && obj.value) {
    if (obj.value.levelName === undefined) obj.value.levelName = '';
    if (obj.value.pathName === undefined) obj.value.pathName = obj.value.pathName || '';
  }
  if ((obj.type === 'ByteProperty' || obj.ueType === 'ByteProperty') && obj.value) {
    if (obj.value.type === undefined && obj.value.enumName !== undefined) {
      obj.value.type = obj.value.enumName;
      delete obj.value.enumName;
    }
    if (obj.value.type === undefined) obj.value.type = 'None';
  }

  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      deepEnsureUeType(obj[k]);
    }
  }
  return obj;
}

function mergeCbpIntoSave() {
  const saveState = getSaveState();
  const cbpState = getCbpState();
  if (!saveState || !cbpState) throw new Error('Both save and CBP must be loaded');

  const sessionId = initSession();
  console.log(`Merge session: ${sessionId}`);

  const cbpRaw = cbpState.raw;
  const save = Parser.ParseSave(saveState.name, saveState.saveBuf);

  const mainLevelKey = Object.keys(save.levels).find(k => {
    const objs = save.levels[k].objects;
    return objs.some(o => o.rootObject === 'Persistent_Level');
  }) || Object.keys(save.levels)[0];
  const mainLevel = save.levels[mainLevelKey];

  const refEntity = saveState.entities[0];
  const saveCustomVersion = refEntity?.saveCustomVersion || 52;

  // Build pathName remapping
  const pathRemap = {};
  let counter = 0;

  for (const entry of cbpRaw.data) {
    const p = entry.parent;
    if (!p || !p.className) continue;
    const cls = p.className.split('.').pop();
    if (!cls.startsWith('Build_')) continue;

    const newId = `${sessionId}_${String(++counter).padStart(4, '0')}`;
    const newInstanceName = `Persistent_Level:PersistentLevel.${cls}_${newId}`;
    pathRemap[p.pathName] = newInstanceName;

    if (p.children) {
      for (const child of p.children) {
        const compSuffix = child.pathName.split('.').pop();
        pathRemap[child.pathName] = `${newInstanceName}.${compSuffix}`;
      }
    }
    if (entry.children) {
      for (const child of entry.children) {
        const compSuffix = child.pathName.split('.').pop();
        if (!pathRemap[child.pathName]) {
          pathRemap[child.pathName] = `${newInstanceName}.${compSuffix}`;
        }
      }
    }
  }

  for (const [oldPath] of Object.entries(cbpRaw.hiddenConnections || {})) {
    if (!pathRemap[oldPath]) {
      const suffix = oldPath.split('.').pop();
      const newId = `${sessionId}_${String(++counter).padStart(4, '0')}`;
      pathRemap[oldPath] = `Persistent_Level:PersistentLevel.RailroadSubsystem.${suffix}_${newId}`;
    }
  }

  console.log(`PathName remap: ${Object.keys(pathRemap).length} entries`);

  function remapPathNames(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(remapPathNames);
    const result = { ...obj };
    if (typeof result.pathName === 'string' && pathRemap[result.pathName]) {
      result.pathName = pathRemap[result.pathName];
    }
    for (const key of Object.keys(result)) {
      if (typeof result[key] === 'object' && result[key] !== null) {
        result[key] = remapPathNames(result[key]);
      }
    }
    return result;
  }

  const newObjects = [];

  for (const entry of cbpRaw.data) {
    const p = entry.parent;
    if (!p || !p.className) continue;
    const cls = p.className.split('.').pop();
    if (!cls.startsWith('Build_')) continue;

    const newInstanceName = pathRemap[p.pathName];
    const tr = p.transform;

    const components = [];
    const children = entry.children || [];
    for (const child of children) {
      const newChildPath = pathRemap[child.pathName];
      if (newChildPath) {
        components.push({ levelName: 'Persistent_Level', pathName: newChildPath });
      }
    }
    if (p.children) {
      for (const child of p.children) {
        const newChildPath = pathRemap[child.pathName];
        if (newChildPath && !components.find(c => c.pathName === newChildPath)) {
          components.push({ levelName: 'Persistent_Level', pathName: newChildPath });
        }
      }
    }

    const properties = p.properties ? remapPathNames(convertCbpProperties(p.properties)) : {};

    const entity = {
      typePath: p.className,
      rootObject: 'Persistent_Level',
      instanceName: newInstanceName,
      flags: 8,
      properties,
      specialProperties: { type: 'EmptySpecialProperties' },
      trailingData: [],
      saveCustomVersion,
      shouldMigrateObjectRefsToPersistent: false,
      parentEntityName: '',
      type: 'SaveEntity',
      needTransform: true,
      wasPlacedInLevel: false,
      parentObject: { levelName: 'Persistent_Level', pathName: 'Persistent_Level:PersistentLevel.BuildableSubsystem' },
      transform: {
        rotation: { x: tr.rotation[0], y: tr.rotation[1], z: tr.rotation[2], w: tr.rotation[3] },
        translation: { x: tr.translation[0], y: tr.translation[1], z: tr.translation[2] },
        scale3d: { x: 1, y: 1, z: 1 },
      },
      components,
    };

    newObjects.push(entity);

    for (const child of children) {
      const newChildPath = pathRemap[child.pathName];
      if (!newChildPath) continue;

      const essentialProps = (child.properties || []).filter(p =>
        p.name === 'mConnectedComponents' || p.name === 'mWires' ||
        p.name === 'mHiddenConnections' || p.name === 'mConnectedTo' ||
        p.name === 'mRailroadTrackConnection' || p.name === 'mComponentDirection' ||
        p.name === 'mSwitchPosition' || p.name === 'mTargetConsumption'
      );
      const compProps = essentialProps.length > 0 ? remapPathNames(convertCbpProperties(essentialProps)) : {};

      const component = {
        typePath: child.className,
        rootObject: 'Persistent_Level',
        instanceName: newChildPath,
        flags: 262152,
        properties: compProps,
        specialProperties: { type: 'EmptySpecialProperties' },
        trailingData: [0, 0, 0, 0],
        saveCustomVersion,
        shouldMigrateObjectRefsToPersistent: false,
        parentEntityName: newInstanceName,
        type: 'SaveComponent',
      };

      newObjects.push(component);
    }
  }

  // Validate
  function validateProps(props, path) {
    if (!props || typeof props !== 'object') return;
    for (const [pName, pVal] of Object.entries(props)) {
      if (!pVal || typeof pVal !== 'object') continue;
      if (pVal.name !== undefined && !pVal.ueType) {
        console.error(`MISSING ueType: ${path}.${pName} type=${pVal.type}`, JSON.stringify(pVal).slice(0, 200));
      }
      if (pVal.value?.properties) validateProps(pVal.value.properties, `${path}.${pName}`);
      if (Array.isArray(pVal.values)) {
        for (const v of pVal.values) {
          if (v?.value?.properties) validateProps(v.value.properties, `${path}.${pName}[]`);
        }
      }
    }
  }

  for (const obj of newObjects) {
    if (obj.properties) deepEnsureUeType(obj.properties);
  }
  for (const obj of newObjects) {
    if (obj.properties) validateProps(obj.properties, obj.instanceName);
  }

  mainLevel.objects.push(...newObjects);
  console.log(`Injected ${newObjects.length} objects (entities + components) into ${mainLevelKey}`);

  const outputName = `${saveState.name}_edit`;
  let headerBuf;
  const bodyChunks = [];
  Parser.WriteSave(save,
    h => { headerBuf = h; },
    c => { bodyChunks.push(c); }
  );
  const outputBuf = Buffer.concat([headerBuf, ...bodyChunks]);
  console.log(`Written save: ${(outputBuf.length / 1024 / 1024).toFixed(1)} MB`);

  return { outputName, outputBuf, entityCount: newObjects.filter(o => o.type === 'SaveEntity').length, totalCount: newObjects.length };
}

module.exports = { mergeCbpIntoSave };
