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
        { id: 'r1', from: 'ts:TrackConnection1', to: { x: -5000, y: 0, z: 0 }, track: true },
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
    // StationA at origin rot 0° (track -X), StationB at Y=8000 rot 180° (track +X)
    // Left side (3 segments): A:TC1 → turn → turn → straight → B:TC1
    // Right side (3 segments): B:TC0 → straight → turn → turn → A:TC0
    const r = editEntities({
      anchor: { x: 700000, y: 0, z: 0 },
      entities: [
        { id: 'stA', type: 'train-station', position: { x: 0, y: 0, z: 0 } },
        { id: 'stB', type: 'train-station', position: { x: 0, y: 8000, z: 0 }, rotation: 180 },
      ],
      connections: [
        // Left side: A:TC1(-800,0) → mid1(-4800,4000) → mid2(-800,8000) → B:TC1(800,8000)
        { id: 'L1', from: 'stA:TrackConnection1', to: { x: -4800, y: 4000, z: 0, rotation: 270 }, track: true },
        { id: 'L2', from: 'L1:TrackConnection1', to: { x: -800, y: 8000, z: 0, rotation: 180 }, track: true },
        { id: 'L3', from: 'L2:TrackConnection1', to: 'stB:TrackConnection1', track: true },
        // Right side: B:TC0(-800,8000) → mid3(800,8000) → mid4(4800,4000) → A:TC0(800,0)
        { id: 'R1', from: 'stB:TrackConnection0', to: { x: 800, y: 8000, z: 0, rotation: 180 }, track: true },
        { id: 'R2', from: 'R1:TrackConnection1', to: { x: 4800, y: 4000, z: 0, rotation: 90 }, track: true },
        { id: 'R3', from: 'R2:TrackConnection1', to: 'stA:TrackConnection0', track: true },
      ],
    });

    // 2 stations + 6 tracks
    assert(r.added.length >= 8, `Expected 2 stations + 6 tracks, got ${r.added.length}`);

    const stA = added(r, 'stA');
    const stB = added(r, 'stB');

    // Stations should be at expected positions
    assertApprox(stA.entity.transform.translation.y, 0, 10, 'StA Y');
    assertApprox(stB.entity.transform.translation.y, 8000, 10, 'StB Y');

    // All 6 track segments should exist
    for (const id of ['L1', 'L2', 'L3', 'R1', 'R2', 'R3']) {
      assert(r.added.find(a => a.id === id), `Track ${id} should exist`);
    }

    // Verify the circuit is connected end-to-end
    const L1 = getBuilder(r.added.find(a => a.id === 'L1').index);
    const L3 = getBuilder(r.added.find(a => a.id === 'L3').index);
    const R1 = getBuilder(r.added.find(a => a.id === 'R1').index);
    const R3 = getBuilder(r.added.find(a => a.id === 'R3').index);

    // Left side connects A:TC1 → ... → B:TC1
    assertConnected(L1, 'TrackConnection0', stA, 'TrackConnection1', 'L1→stA');
    assertConnected(L3, 'TrackConnection1', stB, 'TrackConnection1', 'L3→stB');

    // Right side connects B:TC0 → ... → A:TC0
    assertConnected(R1, 'TrackConnection0', stB, 'TrackConnection0', 'R1→stB');
    assertConnected(R3, 'TrackConnection1', stA, 'TrackConnection0', 'R3→stA');
  });
});
