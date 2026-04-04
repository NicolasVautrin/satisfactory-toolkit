const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { assertApprox, getEntity, added, splineMidpoint } = require('../helpers');

describe('Other', () => {
  it('1. should create a constructor', () => {
    const r = editEntities({
      anchor: { x: 0, y: 0, z: 0 },
      entities: [{ id: 'c1', type: 'constructor', position: { x: 1000, y: 2000, z: 500 } }],
    });
    assert.strictEqual(r.added.length, 1);
    assert(r.added[0].instanceName.includes('ConstructorMk1'));
    const c1 = added(r, 'c1');
    assert(c1, 'Entity should exist in saveState');
  });

  it('2. should apply anchor + rotation 90°', () => {
    const r = editEntities({
      anchor: { x: 1000, y: 10000, z: 500 },
      rotation: 90,
      entities: [{ id: 'c1', type: 'constructor', position: { x: 100, y: 0, z: 0 } }],
    });
    const c1 = added(r, 'c1');
    const t = c1.entity.transform.translation;
    assertApprox(t.x, 1000, 2);
    assertApprox(t.y, 10100, 2);
    assertApprox(t.z, 500, 2);
  });

  it('5. should reject splitter snap on producer', () => {
    assert.throws(() => {
      editEntities({
        anchor: { x: 10000, y: 0, z: 0 },
        entities: [
          { id: 's1', type: 'splitter', position: { x: 0, y: 0, z: 0 } },
          { id: 'c1', type: 'constructor', position: { x: 500, y: 0, z: 0 } },
        ],
        connections: [{ from: 's1:Input1', to: 'c1:Output0' }],
      });
    }, /Cannot snap/);
  });

  it('6. should reject direct connection between two fixed producers', () => {
    assert.throws(() => {
      editEntities({
        anchor: { x: 20000, y: 0, z: 0 },
        entities: [
          { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
          { id: 'c2', type: 'constructor', position: { x: 1000, y: 0, z: 0 } },
        ],
        connections: [{ from: 'c1:Output0', to: 'c2:Input0' }],
      });
    }, /fixed ports|Cannot snap/);
  });

  it('7. should reject reinsertion of already-connected splitter (virgin guard)', () => {
    const r1 = editEntities({
      anchor: { x: 30000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 0, y: 3000, z: 0 } },
      ],
      connections: [{ id: 'b1', from: 'c1:Output0', to: 'c2:Input0', belt: 6 }],
    });
    const beltIdx = r1.added.find(a => a.instanceName?.includes('ConveyorBelt')).index;
    const mid = splineMidpoint(getEntity(beltIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'belt1', index: beltIdx },
        { id: 's1', type: 'splitter' },
      ],
      connections: [{ id: 'sp2', from: 's1', on: 'belt1', position: mid }],
    });
    const splIdx = added(r2, 's1').entity.saveIndex;

    const r3 = editEntities({
      anchor: { x: 35000, y: 0, z: 0 },
      entities: [
        { id: 'c3', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c4', type: 'constructor', position: { x: 0, y: 3000, z: 0 } },
      ],
      connections: [{ id: 'b1', from: 'c3:Output0', to: 'c4:Input0', belt: 6 }],
    });
    const belt2Idx = r3.added.find(a => a.instanceName?.includes('ConveyorBelt')).index;
    const mid2 = splineMidpoint(getEntity(belt2Idx).entity);

    assert.throws(() => {
      editEntities({
        entities: [
          { id: 'belt2', index: belt2Idx },
          { id: 's1', index: splIdx },
        ],
        connections: [{ id: 'sp2', from: 's1', on: 'belt2', position: mid2 }],
      });
    }, /already connected|Cannot reposition/);
  });

  it('9. should reject incompatible port types (belt vs pipe)', () => {
    assert.throws(() => {
      editEntities({
        anchor: { x: 50000, y: 0, z: 0 },
        entities: [
          { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
          { id: 'j1', type: 'pipe-junction', position: { x: 500, y: 0, z: 0 } },
        ],
        connections: [{ from: 'j1:0', to: 'c1:Output0' }],
      });
    }, /Incompatible|port type/);
  });

  it('10. should delete an entity', () => {
    const r1 = editEntities({
      anchor: { x: 60000, y: 0, z: 0 },
      entities: [{ id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } }],
    });
    const idx = added(r1, 'c1').entity.saveIndex;
    assert(getEntity(idx), 'Entity should exist before delete');

    const r2 = editEntities({
      entities: [{ index: idx, deleted: true }],
    });
    assert.strictEqual(r2.deleted.length, 1);
    assert.strictEqual(getEntity(idx), null);
  });

  it('11. should reject repositioning an existing entity', () => {
    const r1 = editEntities({
      anchor: { x: 70000, y: 0, z: 0 },
      entities: [{ id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } }],
    });
    const idx = added(r1, 'c1').entity.saveIndex;

    assert.throws(() => {
      editEntities({
        anchor: { x: 80000, y: 5000, z: 1000 },
        entities: [{ index: idx, position: { x: 0, y: 0, z: 0 } }],
      });
    }, /Cannot reposition/);
  });
});
