const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { assertApprox, getBuilder, assertConnected, added } = require('../helpers');

describe('Track', () => {
  it('33. should create 2 tracks end-to-end by positions', () => {
    const r = editEntities({
      anchor: { x: 600000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'r1', from: { x: 0, y: 0, z: 0 }, to: { x: 2000, y: 0, z: 0 }, track: true },
        { id: 'r2', from: 'r1:TrackConnection1', to: { x: 4000, y: 0, z: 0 }, track: true },
      ],
    });
    assert.strictEqual(r.added.length, 2, 'Expected 2 tracks');

    const r1 = getBuilder(r.added.find(a => a.id === 'r1').index);
    const r2 = getBuilder(r.added.find(a => a.id === 'r2').index);

    // r1 end should match r2 start
    const r1End = r1.port('TrackConnection1').worldPos();
    const r2Start = r2.port('TrackConnection0').worldPos();
    assertApprox(r1End.x, r2Start.x, 2, 'r1 end X should match r2 start X');
    assertApprox(r1End.y, r2Start.y, 2, 'r1 end Y should match r2 start Y');

    // r1 and r2 should be connected
    assertConnected(r1, 'TrackConnection1', r2, 'TrackConnection0', 'r1→r2');
  });

  it('34. should create station with docks and external track', () => {
    const r = editEntities({
      anchor: { x: 650000, y: 0, z: 0 },
      entities: [
        { id: 'ts', type: 'train-station', position: { x: 0, y: 0, z: 0 } },
        { id: 'dock1', type: 'belt-station' },
        { id: 'dock2', type: 'belt-station' },
      ],
      connections: [
        { from: 'dock1:TrackConnection1', to: 'ts:TrackConnection0' },
        { from: 'dock2:TrackConnection1', to: 'dock1:TrackConnection0' },
        { id: 'r1', from: 'ts:TrackConnection1', to: { x: -2000, y: 0, z: 0 }, track: true },
      ],
    });

    const ts = added(r, 'ts');
    const dock1 = added(r, 'dock1');
    const dock2 = added(r, 'dock2');

    // Docks should be repositioned adjacent to station (X decreasing)
    const tsX = ts.entity.transform.translation.x;
    const d1X = dock1.entity.transform.translation.x;
    const d2X = dock2.entity.transform.translation.x;
    assert(d1X > tsX, `dock1 X (${d1X}) should be greater than station X (${tsX})`);
    assert(d2X > d1X, `dock2 X (${d2X}) should be greater than dock1 X (${d1X})`);

    // Belt ports of all docks should point in the same world direction
    const d1Dir = dock1.port('Output0').worldDir();
    const d2Dir = dock2.port('Output0').worldDir();
    const dot = d1Dir.x * d2Dir.x + d1Dir.y * d2Dir.y;
    assertApprox(dot, 1, 0.1, `Dock belt ports should point same direction (dot=${dot})`);

    // Track r1 should be connected to station
    const r1 = getBuilder(r.added.find(a => a.id === 'r1').index);
    assertConnected(r1, 'TrackConnection0', ts, 'TrackConnection1', 'r1→station');
  });

  it('35. should create a loop between 2 stations', () => {
    // StA at (0,0) rot 0°: TC0=(+800,0) TC1=(-800,0)
    // StB at (0,8000) rot 180°: TC0=(-800,8000) TC1=(+800,8000)
    // 4 stubs of exactly 1200 UU at station ports, then 2 arcs (2 segments each)
    const r = editEntities({
      anchor: { x: 700000, y: 0, z: 0 },
      entities: [
        { id: 'stA', type: 'train-station', position: { x: 0, y: 0, z: 0 } },
        { id: 'stB', type: 'train-station', position: { x: 0, y: 8000, z: 0 }, rotation: 180 },
      ],
      connections: [
        // Stubs (exactly 1200 UU each)
        { id: 'sL1', from: 'stA:TrackConnection1', to: { x: -2000, y: 0, z: 0 }, track: true },
        { id: 'sR3', from: 'stA:TrackConnection0', to: { x: 2000, y: 0, z: 0 }, track: true },
        { id: 'sR1', from: 'stB:TrackConnection0', to: { x: -2000, y: 8000, z: 0 }, track: true },
        { id: 'sL3', from: 'stB:TrackConnection1', to: { x: 2000, y: 8000, z: 0 }, track: true },
        // Left arc (2 segments): sL1(-2000,0) → mid(-6000,4000) → sR1(-2000,8000)
        { id: 'L1', from: 'sL1:TrackConnection1', to: { x: -6000, y: 4000, z: 0, rotation: 270 }, track: true },
        { id: 'L2', from: 'sR1:TrackConnection1', to: { x: -6000, y: 4000, z: 0, rotation: 90 }, track: true },
        // Right arc (2 segments): sL3(+2000,8000) → mid(+6000,4000) → sR3(+2000,0)
        { id: 'R1', from: 'sL3:TrackConnection1', to: { x: 6000, y: 4000, z: 0, rotation: 90 }, track: true },
        { id: 'R2', from: 'sR3:TrackConnection1', to: { x: 6000, y: 4000, z: 0, rotation: 270 }, track: true },
      ],
    });

    // 2 stations + 4 stubs + 4 arcs = 10
    assert(r.added.length >= 10, `Expected 2 stations + 8 tracks, got ${r.added.length}`);

    const stA = added(r, 'stA');
    const stB = added(r, 'stB');

    // Stations should be at expected positions
    assertApprox(stA.entity.transform.translation.y, 0, 10, 'StA Y');
    assertApprox(stB.entity.transform.translation.y, 8000, 10, 'StB Y');

    // All track segments should exist
    for (const id of ['sL1', 'sR3', 'sR1', 'sL3', 'L1', 'L2', 'R1', 'R2']) {
      assert(r.added.find(a => a.id === id), `Track ${id} should exist`);
    }

    // Verify stubs are connected to stations
    const sL1 = getBuilder(r.added.find(a => a.id === 'sL1').index);
    const sR3 = getBuilder(r.added.find(a => a.id === 'sR3').index);
    const sR1 = getBuilder(r.added.find(a => a.id === 'sR1').index);
    const sL3 = getBuilder(r.added.find(a => a.id === 'sL3').index);

    assertConnected(sL1, 'TrackConnection0', stA, 'TrackConnection1', 'sL1→stA:TC1');
    assertConnected(sR3, 'TrackConnection0', stA, 'TrackConnection0', 'sR3→stA:TC0');
    assertConnected(sR1, 'TrackConnection0', stB, 'TrackConnection0', 'sR1→stB:TC0');
    assertConnected(sL3, 'TrackConnection0', stB, 'TrackConnection1', 'sL3→stB:TC1');
  });
});
