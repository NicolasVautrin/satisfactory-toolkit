const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { getEntity, getBuilder, added, splineMidpoint, assertConnected } = require('../helpers');

describe('Belt', () => {
  it('3. should auto-create belt between two constructors', () => {
    // Constructors aligned on Y axis so Output0 (+Y) faces Input0 (-Y)
    const r = editEntities({
      anchor: { x: 5000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 0, y: 2000, z: 0 } },
      ],
      connections: [{ id: 'b1', from: 'c1:Output0', to: 'c2:Input0', belt: 6 }],
    });
    assert.strictEqual(r.added.length, 3, 'Expected 2 constructors + 1 belt');
    assert.strictEqual(r.connections.length, 1);
    assert(r.added.find(a => a.instanceName?.includes('ConveyorBelt')), 'Belt should be in added');
  });

  it('12. should connect splitter to constructor via belt:6', () => {
    // Splitter Output1 (+X) → belt → Constructor Input0
    // Constructor rotated -90° so Input0 faces -X (toward splitter)
    const r = editEntities({
      anchor: { x: 90000, y: 0, z: 0 },
      entities: [
        { id: 's1', type: 'splitter', position: { x: 0, y: 0, z: 0 } },
        { id: 'c1', type: 'constructor', position: { x: 2000, y: 0, z: 0 }, rotation: -90 },
      ],
      connections: [{ id: 'b1', from: 's1:Output1', to: 'c1:Input0', belt: 6 }],
    });
    assert.strictEqual(r.added.length, 3, 'Expected splitter + constructor + belt');
  });

  it('13. should insert splitter on belt at midpoint', () => {
    const r1 = editEntities({
      anchor: { x: 100000, y: 0, z: 0 },
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
    assert.strictEqual(r2.added.length, 2, 'Expected splitter + belt2');
    const s1 = added(r2, 's1');
    const t = s1.entity.transform.translation;
    assert(t.y > 0 && t.y < 3600, `Splitter y should be between belt endpoints, got ${t.y}`);

    // Verify connection chain: c1 → belt1 → splitter → belt2 → c2
    const c1 = getBuilder(r1.added.find(a => a.id === 'c1').index);
    const c2 = getBuilder(r1.added.find(a => a.id === 'c2').index);
    const belt1 = getBuilder(beltIdx);
    const belt2Idx = r2.added.find(a => a.id === 'sp2').index;
    const belt2 = getBuilder(belt2Idx);
    assertConnected(c1, 'Output0', belt1, 'ConveyorAny0', 'c1→belt1');
    assertConnected(belt1, 'ConveyorAny1', s1, 'Input1', 'belt1→splitter');
    assertConnected(s1, 'Output1', belt2, 'ConveyorAny0', 'splitter→belt2');
    assertConnected(belt2, 'ConveyorAny1', c2, 'Input0', 'belt2→c2');
  });

  it('14. should insert merger on belt and reposition it', () => {
    const r1 = editEntities({
      anchor: { x: 110000, y: 0, z: 0 },
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
        { id: 'm1', type: 'merger' },
      ],
      connections: [{ id: 'sp2', from: 'm1', on: 'belt1', position: mid }],
    });
    assert.strictEqual(r2.added.length, 2, 'Expected merger + belt2');
    const m1 = added(r2, 'm1');
    const t = m1.entity.transform.translation;
    assert(t.y > 0 && t.y < 3600, `Merger y should be between belt endpoints, got ${t.y}`);

    // Verify connection chain: c1 → belt1 → merger → belt2 → c2
    const c1 = getBuilder(r1.added.find(a => a.id === 'c1').index);
    const c2 = getBuilder(r1.added.find(a => a.id === 'c2').index);
    const belt1 = getBuilder(beltIdx);
    const belt2Idx = r2.added.find(a => a.id === 'sp2').index;
    const belt2 = getBuilder(belt2Idx);
    assertConnected(c1, 'Output0', belt1, 'ConveyorAny0', 'c1→belt1');
    assertConnected(belt1, 'ConveyorAny1', m1, 'Input1', 'belt1→merger');
    assertConnected(m1, 'Output1', belt2, 'ConveyorAny0', 'merger→belt2');
    assertConnected(belt2, 'ConveyorAny1', c2, 'Input0', 'belt2→c2');
  });

  it('31. should reject belt too long', () => {
    assert.throws(() => {
      editEntities({
        anchor: { x: 400000, y: 0, z: 0 },
        entities: [
          { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
          { id: 'c2', type: 'constructor', position: { x: 6000, y: 0, z: 0 } },
        ],
        connections: [{ id: 'b1', from: 'c1:Output0', to: 'c2:Input0', belt: 6 }],
      });
    }, /too long/);
  });

  it('32. should reject belt too short', () => {
    // Two splitters 50 UU apart — Output1→Input1 ports nearly co-located
    assert.throws(() => {
      editEntities({
        anchor: { x: 410000, y: 0, z: 0 },
        entities: [
          { id: 's1', type: 'splitter', position: { x: 0, y: 0, z: 0 } },
          { id: 's2', type: 'splitter', position: { x: 50, y: 0, z: 0 } },
        ],
        connections: [{ id: 'b1', from: 's1:Output1', to: 's2:Input1', belt: 6 }],
      });
    }, /too short/);
  });

  it('31. should create belt and insert merger in same edit', () => {
    const r = editEntities({
      anchor: { x: 500000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 0, y: 3000, z: 0 } },
        { id: 'm1', type: 'merger' },
      ],
      connections: [
        { id: 'b1', from: 'c1:Output0', to: 'c2:Input0', belt: 6 },
        { id: 'b2', from: 'm1', on: 'b1', position: { x: 500000, y: 1500, z: 100 } },
      ],
    });
    const m1 = added(r, 'm1');
    const t = m1.entity.transform.translation;
    assert(t.y > 0 && t.y < 3600, `Merger y should be between belt endpoints, got ${t.y}`);
    assert(r.added.length >= 4, `Expected c1 + c2 + m1 + belt + new_spline, got ${r.added.length}`);

    // Verify connection chain: c1 → b1 → merger → b2 → c2
    const c1 = added(r, 'c1');
    const c2 = added(r, 'c2');
    const b1Idx = r.added.find(a => a.id === 'b1').index;
    const b2Idx = r.added.find(a => a.id === 'b2').index;
    const b1 = getBuilder(b1Idx);
    const b2 = getBuilder(b2Idx);
    assertConnected(c1, 'Output0', b1, 'ConveyorAny0', 'c1→b1');
    assertConnected(b1, 'ConveyorAny1', m1, 'Input1', 'b1→merger');
    assertConnected(m1, 'Output1', b2, 'ConveyorAny0', 'merger→b2');
    assertConnected(b2, 'ConveyorAny1', c2, 'Input0', 'b2→c2');
  });
});
