const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { assertApprox, getEntity, getBuilder, assertPortsAligned, assertLiftTopCardinal, added } = require('../helpers');

describe('Lift', () => {
  it('8. should connect lift bottom to producer and reposition with correct ports', () => {
    const r = editEntities({
      anchor: { x: 40000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'lift1', type: 'lift', position: { x: 0, y: 0, z: 0 } },
      ],
      connections: [{ from: 'lift1:bottom', to: 'c1:Output0' }],
    });
    assert.strictEqual(r.connections.length, 1);
    const lift = added(r, 'lift1');
    const c1 = added(r, 'c1');
    assertPortsAligned(lift.port('bottom'), c1.port('Output0'), 'lift:bottom ↔ c1:Output0');
    assertLiftTopCardinal(lift);
  });

  it('19. should connect lift bottom to another lift top with correct port positions', () => {
    const r1 = editEntities({
      anchor: { x: 150000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'lift1', type: 'lift', position: { x: 0, y: 0, z: 0 } },
      ],
      connections: [{ from: 'lift1:bottom', to: 'c1:Output0' }],
    });
    const lift1 = added(r1, 'lift1');

    const r2 = editEntities({
      anchor: { x: 150000, y: 0, z: 0 },
      entities: [
        { id: 'lift1', index: lift1.entity.saveIndex },
        { id: 'lift2', type: 'lift', position: { x: 0, y: 0, z: 500 } },
      ],
      connections: [{ from: 'lift2:bottom', to: 'lift1:top' }],
    });
    assert.strictEqual(r2.connections.length, 1);
    const lift1b = getBuilder(lift1.entity.saveIndex);
    const lift2 = added(r2, 'lift2');
    assertPortsAligned(lift2.port('bottom'), lift1b.port('top'), 'lift2:bottom ↔ lift1:top');
    assertLiftTopCardinal(lift1b);
    assertLiftTopCardinal(lift2);
  });

  it('20. should reject lift top to lift top with same polarity', () => {
    const r1 = editEntities({
      anchor: { x: 160000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'lift1', type: 'lift', position: { x: 0, y: 0, z: 0 } },
      ],
      connections: [{ from: 'lift1:bottom', to: 'c1:Output0' }],
    });
    const r2 = editEntities({
      anchor: { x: 162000, y: 0, z: 0 },
      entities: [
        { id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'lift2', type: 'lift', position: { x: 0, y: 0, z: 0 } },
      ],
      connections: [{ from: 'lift2:bottom', to: 'c2:Output0' }],
    });
    assert.throws(() => {
      editEntities({
        entities: [
          { id: 'lift1', index: added(r1, 'lift1').entity.saveIndex },
          { id: 'lift2', index: added(r2, 'lift2').entity.saveIndex },
        ],
        connections: [{ from: 'lift1:top', to: 'lift2:top' }],
      });
    }, /both ports are|Incompatible/);
  });

  it('20b. should accept lift top to lift top with opposite polarity', () => {
    const r1 = editEntities({
      anchor: { x: 164000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'lift1', type: 'lift', position: { x: 0, y: 0, z: 0 } },
      ],
      connections: [{ from: 'lift1:bottom', to: 'c1:Output0' }],
    });
    const r2 = editEntities({
      anchor: { x: 166000, y: 0, z: 0 },
      entities: [
        { id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'lift2', type: 'lift', position: { x: 0, y: 0, z: 0 } },
      ],
      connections: [{ from: 'lift2:bottom', to: 'c2:Input0' }],
    });
    const r3 = editEntities({
      entities: [
        { id: 'lift1', index: added(r1, 'lift1').entity.saveIndex },
        { id: 'lift2', index: added(r2, 'lift2').entity.saveIndex },
      ],
      connections: [{ from: 'lift1:top', to: 'lift2:top' }],
    });
    assert.strictEqual(r3.connections.length, 1);
  });

  it('21. should snap merger onto lift top endpoint', () => {
    const r1 = editEntities({
      anchor: { x: 170000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'lift1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 800 } },
      ],
      connections: [{ from: 'lift1:bottom', to: 'c1:Output0' }],
    });
    const lift1 = added(r1, 'lift1');

    const r2 = editEntities({
      entities: [
        { id: 'lift1', index: lift1.entity.saveIndex },
        { id: 'm1', type: 'merger', position: { x: 0, y: 5000, z: 1000 } },
      ],
      connections: [{ from: 'm1:Input1', to: 'lift1:top' }],
    });
    assert.strictEqual(r2.connections.length, 1);
    const merger = added(r2, 'm1');
    const lift = getBuilder(lift1.entity.saveIndex);
    assertPortsAligned(merger.port('Input1'), lift.port('top'), 'merger:Input1 ↔ lift:top');
    assertLiftTopCardinal(lift);
  });

  it('22. should connect lift tops with opposite polarity through belts', () => {
    // Constructor Output0 faces -X (rot 90°), lift bottom faces +X → facing each other
    const r1 = editEntities({
      anchor: { x: 180000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 }, rotation: 90 },
        { id: 'lift1', type: 'lift', position: { x: -1500, y: 0, z: 0 } },
      ],
      connections: [{ from: 'c1:Output0', to: 'lift1:bottom', belt: 6 }],
    });
    // Lift2 bottom faces +X, constructor Input0 faces +X (rot -90°) → facing each other
    const r2 = editEntities({
      anchor: { x: 186000, y: 0, z: 0 },
      entities: [
        { id: 'lift2', type: 'lift', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 1500, y: 0, z: 0 }, rotation: -90 },
      ],
      connections: [{ from: 'lift2:bottom', to: 'c2:Input0', belt: 6 }],
    });
    const r3 = editEntities({
      entities: [
        { id: 'lift1', index: added(r1, 'lift1').entity.saveIndex },
        { id: 'lift2', index: added(r2, 'lift2').entity.saveIndex },
      ],
      connections: [{ from: 'lift1:top', to: 'lift2:top' }],
    });
    assert.strictEqual(r3.connections.length, 1);
  });

  it('23. should reject lift tops with same polarity through belts', () => {
    const r1 = editEntities({
      anchor: { x: 190000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 }, rotation: 90 },
        { id: 'lift1', type: 'lift', position: { x: -1500, y: 0, z: 0 } },
      ],
      connections: [{ from: 'c1:Output0', to: 'lift1:bottom', belt: 6 }],
    });
    const r2 = editEntities({
      anchor: { x: 194000, y: 0, z: 0 },
      entities: [
        { id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 0 }, rotation: 90 },
        { id: 'lift2', type: 'lift', position: { x: -1500, y: 0, z: 0 } },
      ],
      connections: [{ from: 'c2:Output0', to: 'lift2:bottom', belt: 6 }],
    });
    assert.throws(() => {
      editEntities({
        entities: [
          { id: 'lift1', index: added(r1, 'lift1').entity.saveIndex },
          { id: 'lift2', index: added(r2, 'lift2').entity.saveIndex },
        ],
        connections: [{ from: 'lift1:top', to: 'lift2:top' }],
      });
    }, /both ports are|Incompatible/);
  });

  it('24. should set top arm direction for all 4 cardinal directions', () => {
    // Create 4 lifts with different topDir values, all snapped to same constructor
    const FRONT = { x: 1, y: 0 }, BACK = { x: -1, y: 0 }, RIGHT = { x: 0, y: 1 }, LEFT = { x: 0, y: -1 };
    const dirs = [['FRONT', FRONT, 1], ['BACK', BACK, -1], ['RIGHT', RIGHT, 0], ['LEFT', LEFT, 0]];

    for (let i = 0; i < dirs.length; i++) {
      const [name, topDir, expectedDot] = dirs[i];
      const r = editEntities({
        anchor: { x: 200000 + i * 4000, y: 0, z: 0 },
        entities: [
          { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
          { id: 'lift1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { topDir } },
        ],
        connections: [{ from: 'lift1:bottom', to: 'c1:Output0' }],
      });
      const lift = added(r, 'lift1');
      assertLiftTopCardinal(lift);

      const topD = lift.port('top').worldDir();
      const botD = lift.port('bottom').worldDir();
      const dot = topD.x * botD.x + topD.y * botD.y;
      assertApprox(dot, expectedDot, 0.1, `${name}: dot=${dot}, expected=${expectedDot}`);
    }
  });

  it('33. should reject lift too tall', () => {
    assert.throws(() => {
      editEntities({
        anchor: { x: 210000, y: 0, z: 0 },
        entities: [
          { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
          { id: 'lift1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 5000 } },
        ],
        connections: [{ from: 'lift1:bottom', to: 'c1:Output0' }],
      });
    }, /too long/);
  });

  it('34. should reject lift too short', () => {
    assert.throws(() => {
      editEntities({
        anchor: { x: 220000, y: 0, z: 0 },
        entities: [
          { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
          { id: 'lift1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 300 } },
        ],
        connections: [{ from: 'lift1:bottom', to: 'c1:Output0' }],
      });
    }, /too short/);
  });
});
