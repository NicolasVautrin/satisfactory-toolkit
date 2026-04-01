const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { getEntity, added, splineMidpoint } = require('../helpers');

describe('Belt', () => {
  it('3. should auto-create belt between two constructors', () => {
    const r = editEntities({
      anchor: { x: 5000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 2000, y: 0, z: 0 } },
      ],
      connections: [{ from: 'c1:Output0', to: 'c2:Input0', belt: 6 }],
    });
    assert.strictEqual(r.added.length, 3, 'Expected 2 constructors + 1 belt');
    assert.strictEqual(r.connections.length, 1);
    assert(r.added.find(a => a.instanceName?.includes('ConveyorBelt')), 'Belt should be in added');
  });

  it('12. should connect splitter to constructor via belt:6', () => {
    const r = editEntities({
      anchor: { x: 90000, y: 0, z: 0 },
      entities: [
        { id: 's1', type: 'splitter', position: { x: 0, y: 0, z: 0 } },
        { id: 'c1', type: 'constructor', position: { x: 1000, y: 0, z: 0 } },
      ],
      connections: [{ from: 's1:Output1', to: 'c1:Input0', belt: 6 }],
    });
    assert.strictEqual(r.added.length, 3, 'Expected splitter + constructor + belt');
  });

  it('13. should insert splitter on belt at midpoint', () => {
    const r1 = editEntities({
      anchor: { x: 100000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 3000, y: 0, z: 0 } },
      ],
      connections: [{ from: 'c1:Output0', to: 'c2:Input0', belt: 6 }],
    });
    const beltIdx = r1.added.find(a => a.instanceName?.includes('ConveyorBelt')).index;
    const mid = splineMidpoint(getEntity(beltIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'belt1', index: beltIdx },
        { id: 's1', type: 'splitter' },
      ],
      connections: [{ from: 's1', on: 'belt1', position: mid }],
    });
    assert.strictEqual(r2.added.length, 2, 'Expected splitter + belt2');
    const s1 = added(r2, 's1');
    const t = s1.entity.transform.translation;
    assert(t.x > 100000 && t.x < 104000, `Splitter x should be between belt endpoints, got ${t.x}`);
  });

  it('14. should insert merger on belt and reposition it', () => {
    const r1 = editEntities({
      anchor: { x: 110000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 3000, y: 0, z: 0 } },
      ],
      connections: [{ from: 'c1:Output0', to: 'c2:Input0', belt: 6 }],
    });
    const beltIdx = r1.added.find(a => a.instanceName?.includes('ConveyorBelt')).index;
    const mid = splineMidpoint(getEntity(beltIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'belt1', index: beltIdx },
        { id: 'm1', type: 'merger' },
      ],
      connections: [{ from: 'm1', on: 'belt1', position: mid }],
    });
    assert.strictEqual(r2.added.length, 2, 'Expected merger + belt2');
    const m1 = added(r2, 'm1');
    const t = m1.entity.transform.translation;
    assert(t.x > 110000 && t.x < 114000, `Merger x should be between belt endpoints, got ${t.x}`);
  });
});
