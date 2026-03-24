const Vector3D   = require('./shared/Vector3D');
const Quaternion = require('./shared/Quaternion');
const Transform  = require('./shared/Transform');
const FlowPort   = require('./shared/FlowPort');
const Registry   = require('./Registry');

/**
 * Blueprint — a composite building made of multiple machines.
 *
 * Same interface as individual machines: allObjects(), port(name).
 * Two static factories:
 *   Blueprint.create(name, x, y, z, rot)   — programmatic
 *   Blueprint.fromFile(sbp, cfg, x, y, z, rot) — from .sbp file
 *
 * Never call `new Blueprint()` directly.
 */
class Blueprint {
  constructor(name, transform) {
    this.name       = name;
    this._transform = transform;
    this._nodes   = {};   // id → machine instance
    this._objects  = [];   // all SaveEntity + SaveComponent
    this._exposed  = {};   // externalName → { nodeId, portName }
    this._wires    = [];   // { fromNode, fromPort, toNode, toPort }
  }

  // ── Public interface (same as machines) ────────────────────────────

  allObjects() {
    return this._objects;
  }

  port(name) {
    const ep = this._exposed[name];
    if (!ep) throw new Error(`Blueprint "${this.name}": unknown port "${name}"`);
    const machine = this._nodes[ep.nodeId];
    if (!machine) throw new Error(`Blueprint "${this.name}": unknown node "${ep.nodeId}"`);
    return machine.port(ep.portName);
  }

  // ── Building the blueprint ─────────────────────────────────────────

  /**
   * Add a machine to the blueprint.
   * @param {string} id       Unique identifier within this blueprint
   * @param {Function} Builder  Class with static create(x, y, z, rot)
   * @param {{x,y,z}} relPos  Position relative to blueprint origin (default: origin)
   * @param {{x,y,z,w}} relRot  Rotation relative to blueprint (default: identity)
   * @param {string} [recipe]  Recipe path to set
   */
  addNode(id, Builder, relPos = { x: 0, y: 0, z: 0 }, relRot = Quaternion.IDENTITY, recipe = null) {
    if (this._nodes[id]) {
      throw new Error(`Blueprint "${this.name}": duplicate node id "${id}"`);
    }

    const localTransform = new Transform(relPos, relRot);
    const worldTransform = this._transform.apply(localTransform);

    const machine = Builder.create(
      worldTransform.translation.x, worldTransform.translation.y, worldTransform.translation.z,
      worldTransform.rotation,
    );
    if (recipe && machine.setRecipe) {
      machine.setRecipe(recipe);
    }

    this._nodes[id] = machine;
    this._objects.push(...machine.allObjects());
    this.autoAttach();
    return this;
  }

  /**
   * Expose an internal node's port as an external port of the blueprint.
   */
  exposePort(externalName, nodeId, portName) {
    if (!this._nodes[nodeId]) {
      throw new Error(`Blueprint "${this.name}": unknown node "${nodeId}"`);
    }
    this._exposed[externalName] = { nodeId, portName };
    return this;
  }

  /**
   * Wire two internal nodes' ports together.
   */
  wire(fromNode, fromPort, toNode, toPort) {
    const from = this._nodes[fromNode];
    const to   = this._nodes[toNode];
    if (!from) throw new Error(`Blueprint "${this.name}": unknown node "${fromNode}"`);
    if (!to) throw new Error(`Blueprint "${this.name}": unknown node "${toNode}"`);
    from.port(fromPort).wire(to.port(toPort));
    return this;
  }

  // ── Auto-connect ───────────────────────────────────────────────────

  /**
   * Find compatible port pairs: close enough, same type, opposite flow, facing each other.
   * @param {number} tolerance  Max distance between ports (UU)
   * @returns {Array<{a: FlowPort, b: FlowPort}>}
   */
  _findMatchingPorts(tolerance) {
    const allPorts = [];
    for (const [nodeId, machine] of Object.entries(this._nodes)) {
      const machinePorts = machine.ports || machine._ports;
      if (!machinePorts) continue;
      for (const [portName, port] of Object.entries(machinePorts)) {
        if (!port.pos || port.isConnected) continue;
        allPorts.push({ nodeId, portName, port });
      }
    }

    const matches = [];
    for (let i = 0; i < allPorts.length; i++) {
      const a = allPorts[i];
      if (a.port.isConnected) continue;

      for (let j = i + 1; j < allPorts.length; j++) {
        const b = allPorts[j];
        if (b.port.isConnected) continue;
        if (a.nodeId === b.nodeId) continue;
        if (a.port.portType !== b.port.portType) continue;
        if (a.port.flowType && b.port.flowType && a.port.flowType === b.port.flowType) continue;

        const dist = new Vector3D(a.port.pos).sub(new Vector3D(b.port.pos)).length;
        if (dist > tolerance) continue;

        if (a.port.dir && b.port.dir) {
          const dot = new Vector3D(a.port.dir).dot(new Vector3D(b.port.dir));
          if (dot >= 0) continue;
        }

        matches.push({ a: a.port, b: b.port });
      }
    }
    return matches;
  }

  /**
   * Auto-attach: wire + snap all matching ports (same as game's auto-connect).
   * @param {number} tolerance  Max distance between ports (UU, default 1)
   * @returns {number} Number of connections made
   */
  autoAttach(tolerance = 1) {
    const matches = this._findMatchingPorts(tolerance);
    for (const { a, b } of matches) {
      if (a.isConnected || b.isConnected) continue;
      a.attach(b);
    }
    return matches.length;
  }

  // ── Clearance (derived) ────────────────────────────────────────────

  get clearance() {
    const { getClearance } = require('../satisfactoryLib');
    const min = { x: Infinity, y: Infinity, z: Infinity };
    const max = { x: -Infinity, y: -Infinity, z: -Infinity };

    for (const obj of this._objects) {
      if (!obj.transform?.translation || !obj.typePath) continue;
      const cl = getClearance(obj.typePath);
      if (!cl) continue;

      const pos = obj.transform.translation;
      const rot = obj.transform.rotation;

      for (const box of cl.boxes) {
        const corners = [
          { x: box.min.x, y: box.min.y, z: box.min.z },
          { x: box.max.x, y: box.min.y, z: box.min.z },
          { x: box.min.x, y: box.max.y, z: box.min.z },
          { x: box.max.x, y: box.max.y, z: box.min.z },
          { x: box.min.x, y: box.min.y, z: box.max.z },
          { x: box.max.x, y: box.min.y, z: box.max.z },
          { x: box.min.x, y: box.max.y, z: box.max.z },
          { x: box.max.x, y: box.max.y, z: box.max.z },
        ];
        for (const corner of corners) {
          const world = new Vector3D(corner).rotate(rot).add(new Vector3D(pos));
          min.x = Math.min(min.x, world.x);
          min.y = Math.min(min.y, world.y);
          min.z = Math.min(min.z, world.z);
          max.x = Math.max(max.x, world.x);
          max.y = Math.max(max.y, world.y);
          max.z = Math.max(max.z, world.z);
        }
      }
    }

    return { min, max };
  }

  get size() {
    const c = this.clearance;
    return { x: c.max.x - c.min.x, y: c.max.y - c.min.y, z: c.max.z - c.min.z };
  }

  // ── Serialization ─────────────────────────────────────────────────

  /**
   * Write this blueprint to .sbp + .sbpcfg files.
   * Converts world-space objects back to blueprint-local space.
   * @param {string} sbpPath    Output path for .sbp file
   * @param {string} sbpcfgPath Output path for .sbpcfg file (default: same dir, .sbpcfg ext)
   * @param {object} [opts]     Optional overrides
   * @param {string} [opts.description]  Blueprint description
   * @param {{r,g,b,a}} [opts.color]     Blueprint color (0–1 floats)
   * @param {number} [opts.iconID]       Blueprint icon ID
   */
  toBuffers(opts = {}) {
    const { Parser, SaveEntity, SaveComponent } = require('@etothepii/satisfactory-file-parser');

    // Inverse transform: world → blueprint-local
    const inv = this._transform.inverse();

    // Deep-clone objects and convert to local space
    const localObjects = [];

    for (const obj of this._objects) {
      const clone = this._cloneObject(obj);

      // Convert entity transforms to local space
      if (clone.transform?.translation) {
        const localT = inv.apply(new Transform(clone.transform.translation, clone.transform.rotation));
        clone.transform = {
          rotation:    { x: localT.rotation.x, y: localT.rotation.y, z: localT.rotation.z, w: localT.rotation.w },
          translation: { x: localT.translation.x, y: localT.translation.y, z: localT.translation.z },
          scale3d:     clone.transform.scale3d || { x: 1, y: 1, z: 1 },
        };
      }

      // Ensure required fields for the parser
      clone.rootObject = 'Persistent_Level';
      clone.saveCustomVersion = clone.saveCustomVersion || 0;
      clone.trailingData = clone.trailingData || [];
      clone.shouldMigrateObjectRefsToPersistent = false;

      if (clone instanceof SaveEntity || clone.type === 'SaveEntity') {
        clone.needTransform = true;
        clone.wasPlacedInLevel = false;
        clone.parentObject = { levelName: 'Persistent_Level', pathName: 'Persistent_Level:PersistentLevel.BuildableSubsystem' };
        clone.components = clone.components || [];
      }

      localObjects.push(clone);
    }

    // Collect unique recipes from objects
    const recipeSet = new Set();
    for (const obj of localObjects) {
      const recipe = obj.properties?.mBuiltWithRecipe?.value?.pathName;
      if (recipe) recipeSet.add(recipe);
    }

    // Build blueprint structure
    const bpName = opts.name || this.name;
    const blueprint = {
      name: bpName,
      compressionInfo: {
        chunkHeaderVersion: 572662306,
        packageFileTag: 2653586369,
        maxUncompressedChunkContentSize: 131072,
        compressionAlgorithm: 3,  // ZLIB
      },
      header: {
        headerVersion: 2,
        saveVersion: 46,
        buildVersion: 378208,
        itemCosts: [],
        recipeReferences: [...recipeSet].map(r => ({ levelName: '', pathName: r })),
      },
      config: {
        configVersion: 3,
        description: opts.description || this.name || '',
        color: opts.color || { r: 0.2, g: 0.4, b: 0.6, a: 1 },
        iconID: opts.iconID || 782,
        referencedIconLibrary: '/Game/FactoryGame/-Shared/Blueprint/IconLibrary',
        iconLibraryType: 'IconLibrary',
      },
      objects: localObjects,
    };

    // Serialize
    const headerChunks = [];
    let fileHeader = null;
    const result = Parser.WriteBlueprintFiles(
      blueprint,
      (h) => { fileHeader = new Uint8Array(h); },
      (c) => { headerChunks.push(new Uint8Array(c)); },
    );

    // Build .sbp buffer (header + chunks)
    const sbpParts = [fileHeader, ...headerChunks];
    const sbpTotal = sbpParts.reduce((s, p) => s + p.length, 0);
    const sbpBuf   = Buffer.alloc(sbpTotal);
    let offset = 0;
    for (const part of sbpParts) {
      sbpBuf.set(part, offset);
      offset += part.length;
    }

    // Build .sbpcfg buffer
    const cfgBuf = Buffer.from(result.configFileBinary);

    return { sbpBuf, cfgBuf };
  }

  toFile(sbpPath, sbpcfgPath, opts = {}) {
    const fs = require('fs');
    const path = require('path');
    if (!sbpcfgPath) sbpcfgPath = sbpPath.replace(/\.sbp$/, '.sbpcfg');
    if (!opts.name) opts.name = path.basename(sbpPath, '.sbp');
    const { sbpBuf, cfgBuf } = this.toBuffers(opts);
    fs.writeFileSync(sbpPath, sbpBuf);
    fs.writeFileSync(sbpcfgPath, cfgBuf);
    return { sbpPath, sbpcfgPath };
  }

  /** Deep-clone a SaveEntity or SaveComponent preserving its prototype. */
  _cloneObject(obj) {
    const { SaveEntity, SaveComponent } = require('@etothepii/satisfactory-file-parser');
    const json = JSON.parse(JSON.stringify(obj));

    if (obj instanceof SaveEntity || obj.type === 'SaveEntity') {
      const clone = new SaveEntity(json.typePath, json.rootObject, json.instanceName, json.parentEntityName || '');
      Object.assign(clone, json);
      return clone;
    }
    if (obj instanceof SaveComponent || obj.type === 'SaveComponent') {
      const clone = new SaveComponent(json.typePath, json.rootObject, json.instanceName, json.parentEntityName || '');
      Object.assign(clone, json);
      return clone;
    }
    return json;
  }

  // ── Static factories ───────────────────────────────────────────────

  /**
   * Create a new empty blueprint at a world position.
   * Use addNode() to populate it.
   * @param {string} name
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {{x,y,z,w}} rotation
   * @returns {Blueprint}
   */
  static create(name, x, y, z, rotation = Quaternion.IDENTITY) {
    return new Blueprint(name, new Transform({ x, y, z }, rotation));
  }

  /**
   * Create a blueprint from .sbp + .sbpcfg files at a world position.
   * Entities are created via the Registry and positioned in world space.
   * @param {string} sbpPath
   * @param {string} sbpcfgPath
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @param {{x,y,z,w}} rotation
   * @returns {Blueprint}
   */
  static fromFile(sbpPath, sbpcfgPath, x, y, z, rotation = Quaternion.IDENTITY) {
    const fs = require('fs');
    const { Parser } = require('@etothepii/satisfactory-file-parser');

    const sbpBuf = fs.readFileSync(sbpPath);
    const cfgBuf = fs.readFileSync(sbpcfgPath);
    const sbpAB  = sbpBuf.buffer.slice(sbpBuf.byteOffset, sbpBuf.byteOffset + sbpBuf.byteLength);
    const cfgAB  = cfgBuf.buffer.slice(cfgBuf.byteOffset, cfgBuf.byteOffset + cfgBuf.byteLength);

    const name   = require('path').basename(sbpPath, '.sbp');
    const parsed = Parser.ParseBlueprintFiles(name, sbpAB, cfgAB);

    const blueprintTransform = new Transform({ x, y, z }, rotation);
    const bp = new Blueprint(parsed.config?.description || name, blueprintTransform);
    const registry = Registry.default();
    const entities = parsed.objects.filter(o => o.type === 'SaveEntity' && o.transform);

    // Separate PowerLines from other entities
    const powerLines = [];
    const others     = [];
    for (const ent of entities) {
      if (ent.typePath.includes('PowerLine')) {
        powerLines.push(ent);
      } else {
        others.push(ent);
      }
    }

    // 1. Create all non-PowerLine entities, build instanceName mapping
    const nameMap = {};  // old instanceName → new instanceName
    for (let i = 0; i < others.length; i++) {
      const ent       = others[i];
      const className = ent.typePath.split('.').pop();
      const id        = `${className}_${i}`;
      const oldInst   = ent.instanceName;

      const machine = registry.createFromBlueprint(ent, blueprintTransform);
      if (machine) {
        bp._nodes[id] = machine;
        bp._objects.push(...machine.allObjects());

        // Map old instance name → new instance name
        const newInst = machine.entity?.instanceName || machine.inst;
        if (newInst) {
          nameMap[oldInst] = newInst;
          // Also map component names (old.CompName → new.CompName)
          for (const oldComp of (ent.components || [])) {
            const compShort = oldComp.pathName.split('.').pop();
            nameMap[oldComp.pathName] = `${newInst}.${compShort}`;
          }
        }
      }
    }

    // 2. Create PowerLines with remapped source/target references
    const { makeEntity, nextId, ref } = require('../satisfactoryLib');
    for (let i = 0; i < powerLines.length; i++) {
      const ent = powerLines[i];
      const id  = `Build_PowerLine_C_${i}`;

      const plId   = nextId();
      const plInst = `Persistent_Level:PersistentLevel.Build_PowerLine_C_${plId}`;

      // Remap source/target references
      const oldSource = ent.specialProperties?.source?.pathName || '';
      const oldTarget = ent.specialProperties?.target?.pathName || '';
      const newSource = nameMap[oldSource];
      const newTarget = nameMap[oldTarget];

      if (!newSource || !newTarget) continue;  // skip if refs can't be resolved

      const worldPos = blueprintTransform.apply(ent.transform.translation);

      const plEntity = makeEntity('/Game/FactoryGame/Buildable/Factory/PowerLine/Build_PowerLine.Build_PowerLine_C', plInst);
      plEntity.transform = {
        rotation:    { x: 0, y: 0, z: 0, w: 1 },
        translation: worldPos,
        scale3d:     { x: 1, y: 1, z: 1 },
      };
      plEntity.components = [];
      plEntity.properties = JSON.parse(JSON.stringify(ent.properties || {}));
      plEntity.specialProperties = {
        type:   'PowerLineSpecialProperties',
        source: ref(newSource),
        target: ref(newTarget),
      };

      // Update mWires on source and target power connections
      const sourceComp = bp._objects.find(o => o.instanceName === newSource);
      const targetComp = bp._objects.find(o => o.instanceName === newTarget);
      if (sourceComp) {
        if (!sourceComp.properties.mWires) {
          sourceComp.properties.mWires = { type: 'ObjectArrayProperty', ueType: 'ArrayProperty', name: 'mWires', subtype: 'ObjectProperty', values: [] };
        }
        sourceComp.properties.mWires.values.push(ref(plInst));
      }
      if (targetComp) {
        if (!targetComp.properties.mWires) {
          targetComp.properties.mWires = { type: 'ObjectArrayProperty', ueType: 'ArrayProperty', name: 'mWires', subtype: 'ObjectProperty', values: [] };
        }
        targetComp.properties.mWires.values.push(ref(plInst));
      }

      bp._nodes[id] = { entity: plEntity, allObjects: () => [plEntity] };
      bp._objects.push(plEntity);
    }

    // 3. Rebuild port connections via FlowPort.attach()
    //    Build index: new component instanceName → FlowPort
    const portIndex = {};
    for (const machine of Object.values(bp._nodes)) {
      const machinePorts = machine.ports || machine._ports;
      if (!machinePorts) continue;
      for (const port of Object.values(machinePorts)) {
        if (port.pathName) portIndex[port.pathName] = port;
      }
    }

    //    For each wired pair in the original blueprint, attach the new ports
    const origComponents = parsed.objects.filter(o => o.type === 'SaveComponent');
    const visited = new Set();
    for (const origComp of origComponents) {
      const connRef = origComp.properties?.mConnectedComponent?.value?.pathName;
      if (!connRef) continue;

      const key = [origComp.instanceName, connRef].sort().join('|');
      if (visited.has(key)) continue;
      visited.add(key);

      const newA = nameMap[origComp.instanceName];
      const newB = nameMap[connRef];
      if (!newA || !newB) continue;

      const portA = portIndex[newA];
      const portB = portIndex[newB];
      if (!portA || !portB) continue;
      if (portA.isConnected || portB.isConnected) continue;

      portA.attach(portB);
    }

    // 4. Auto-attach remaining unconnected ports (supports/poles snap by proximity)
    bp.autoAttach();

    return bp;
  }
}

module.exports = Blueprint;
