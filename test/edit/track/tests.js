const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { assertApprox, getBuilder, assertConnected, assertTrackLoop, added } = require('../helpers');

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
        // Connect arcs at their meeting points (explicit — track connections are never automatic)
        { from: 'L1:TrackConnection1', to: 'L2:TrackConnection1' },
        { from: 'R1:TrackConnection1', to: 'R2:TrackConnection1' },
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

    // Verify the full loop is connected (BFS with integrated track direction constraint)
    const stAIdx = r.added.find(a => a.id === 'stA').index;
    const stBIdx = r.added.find(a => a.id === 'stB').index;
    assertTrackLoop([stAIdx, stBIdx], 'railway loop');
  });

  it('36. should reject loop when stations face same direction (inconsistent traversal)', () => {
    // Both stations at rotation 0° → integrated tracks traversed in opposite directions
    // StA at (0,0) rot 0°: TC0=(+800,0) TC1=(-800,0)
    // StB at (0,8000) rot 0°: TC0=(+800,8000) TC1=(-800,8000)
    const r = editEntities({
      anchor: { x: 750000, y: 0, z: 0 },
      entities: [
        { id: 'stA', type: 'train-station', position: { x: 0, y: 0, z: 0 } },
        { id: 'stB', type: 'train-station', position: { x: 0, y: 8000, z: 0 } },
      ],
      connections: [
        // Stubs
        { id: 'sL1', from: 'stA:TrackConnection1', to: { x: -2000, y: 0, z: 0 }, track: true },
        { id: 'sR3', from: 'stA:TrackConnection0', to: { x: 2000, y: 0, z: 0 }, track: true },
        { id: 'sR1', from: 'stB:TrackConnection1', to: { x: -2000, y: 8000, z: 0 }, track: true },
        { id: 'sL3', from: 'stB:TrackConnection0', to: { x: 2000, y: 8000, z: 0 }, track: true },
        // Left arc
        { id: 'L1', from: 'sL1:TrackConnection1', to: { x: -6000, y: 4000, z: 0, rotation: 270 }, track: true },
        { id: 'L2', from: 'sR1:TrackConnection1', to: { x: -6000, y: 4000, z: 0, rotation: 90 }, track: true },
        // Right arc
        { id: 'R1', from: 'sL3:TrackConnection1', to: { x: 6000, y: 4000, z: 0, rotation: 90 }, track: true },
        { id: 'R2', from: 'sR3:TrackConnection1', to: { x: 6000, y: 4000, z: 0, rotation: 270 }, track: true },
        // Connect arcs
        { from: 'L1:TrackConnection1', to: 'L2:TrackConnection1' },
        { from: 'R1:TrackConnection1', to: 'R2:TrackConnection1' },
      ],
    });

    const stAIdx = r.added.find(a => a.id === 'stA').index;
    const stBIdx = r.added.find(a => a.id === 'stB').index;

    assert.throws(
      () => assertTrackLoop([stAIdx, stBIdx], 'bad loop'),
      /no valid loop/,
      'assertTrackLoop should reject stations facing same direction',
    );
  });

  it('37. should create double-track railway with 3 stations, bypasses, and return loop', () => {
    // Double-track racetrack: outbound (X=0, +Y) through 3 stations, return (X=8000, -Y)
    // Bypasses at each station, crossovers between loops, arcs at top/bottom
    // All stations rotation 90° (face +Y): TC0=NORTH (+800), TC1=SOUTH (-800)
    // Outbound (south→north): enter via TC1 (south), exit via TC0 (north)
    //
    // planTrackPath validated arcs: apex top (4000,30200), apex bottom (4000,-6200)
    const r = editEntities({
      anchor: { x: 850000, y: 0, z: 0 },
      entities: [
        { id: 'stA', type: 'train-station', position: { x: 0, y: 0, z: 0 }, rotation: 90 },
        { id: 'stB', type: 'train-station', position: { x: 0, y: 12000, z: 0 }, rotation: 90 },
        { id: 'stC', type: 'train-station', position: { x: 0, y: 24000, z: 0 }, rotation: 90 },
      ],
      connections: [
        // === STUBS (1200 UU each, auto-connect to station) ===
        // Entry stubs connect to TC1 (south), exit stubs to TC0 (north)
        { id: 'sA_in', from: 'stA:TrackConnection1', to: { x: 0, y: -2000, z: 0 }, track: true },
        { id: 'sA_out', from: 'stA:TrackConnection0', to: { x: 0, y: 2000, z: 0 }, track: true },
        { id: 'sB_in', from: 'stB:TrackConnection1', to: { x: 0, y: 10000, z: 0 }, track: true },
        { id: 'sB_out', from: 'stB:TrackConnection0', to: { x: 0, y: 14000, z: 0 }, track: true },
        { id: 'sC_in', from: 'stC:TrackConnection1', to: { x: 0, y: 22000, z: 0 }, track: true },
        { id: 'sC_out', from: 'stC:TrackConnection0', to: { x: 0, y: 26000, z: 0 }, track: true },

        // === BYPASSES (straight, 4000 UU) ===
        { id: 'bypA', from: { x: 0, y: -2000, z: 0 }, to: { x: 0, y: 2000, z: 0 }, track: true },
        { id: 'bypB', from: { x: 0, y: 10000, z: 0 }, to: { x: 0, y: 14000, z: 0 }, track: true },
        { id: 'bypC', from: { x: 0, y: 22000, z: 0 }, to: { x: 0, y: 26000, z: 0 }, track: true },

        // === OUTBOUND MAIN LINE (straight, 8000 UU) ===
        { id: 'outAB', from: { x: 0, y: 2000, z: 0 }, to: { x: 0, y: 10000, z: 0 }, track: true },
        { id: 'outBC', from: { x: 0, y: 14000, z: 0 }, to: { x: 0, y: 22000, z: 0 }, track: true },

        // === CROSSOVERS (straight east-west, 8000 UU) ===
        { id: 'xA_to', from: { x: 0, y: 2000, z: 0 }, to: { x: 8000, y: 2000, z: 0 }, track: true },
        { id: 'xB_from', from: { x: 8000, y: 10000, z: 0 }, to: { x: 0, y: 10000, z: 0 }, track: true },
        { id: 'xB_to', from: { x: 0, y: 14000, z: 0 }, to: { x: 8000, y: 14000, z: 0 }, track: true },
        { id: 'xC_from', from: { x: 8000, y: 22000, z: 0 }, to: { x: 0, y: 22000, z: 0 }, track: true },

        // === TOP ARCS (chained, from planTrackPath) ===
        { id: 'topArc1', from: 'sC_out:TrackConnection1', to: { x: 4000, y: 30200, z: 0, rotation: 180 }, track: true },
        { id: 'topArc2', from: 'topArc1:TrackConnection1', to: { x: 8000, y: 26000, z: 0, rotation: 90 }, track: true },

        // === RETURN TRACKS (chained, X=8000) ===
        { id: 'ret1', from: 'topArc2:TrackConnection1', to: { x: 8000, y: 22000, z: 0 }, track: true },
        { id: 'ret2', from: 'ret1:TrackConnection1', to: { x: 8000, y: 14000, z: 0 }, track: true },
        { id: 'ret3', from: 'ret2:TrackConnection1', to: { x: 8000, y: 10000, z: 0 }, track: true },
        { id: 'ret4', from: 'ret3:TrackConnection1', to: { x: 8000, y: 2000, z: 0 }, track: true },
        { id: 'ret5', from: 'ret4:TrackConnection1', to: { x: 8000, y: -2000, z: 0 }, track: true },

        // === BOTTOM ARCS (chained, from planTrackPath) ===
        { id: 'botArc1', from: 'ret5:TrackConnection1', to: { x: 4000, y: -6200, z: 0, rotation: 0 }, track: true },
        { id: 'botArc2', from: 'botArc1:TrackConnection1', to: { x: 0, y: -2000, z: 0, rotation: 270 }, track: true },

        // === SWITCH CONNECTIONS (19 explicit) ===
        // nA_in (0,-2000): sA_in.TC1 hub
        { from: 'bypA:TrackConnection0', to: 'sA_in:TrackConnection1' },
        { from: 'botArc2:TrackConnection1', to: 'sA_in:TrackConnection1' },
        // nA_out (0,2000): sA_out.TC1 hub — 3-way switch
        { from: 'bypA:TrackConnection1', to: 'sA_out:TrackConnection1' },
        { from: 'outAB:TrackConnection0', to: 'sA_out:TrackConnection1' },
        { from: 'xA_to:TrackConnection0', to: 'sA_out:TrackConnection1' },
        // nB_in (0,10000): sB_in.TC1 hub — 3-way switch
        { from: 'bypB:TrackConnection0', to: 'sB_in:TrackConnection1' },
        { from: 'outAB:TrackConnection1', to: 'sB_in:TrackConnection1' },
        { from: 'xB_from:TrackConnection1', to: 'sB_in:TrackConnection1' },
        // nB_out (0,14000): sB_out.TC1 hub — 3-way switch
        { from: 'bypB:TrackConnection1', to: 'sB_out:TrackConnection1' },
        { from: 'outBC:TrackConnection0', to: 'sB_out:TrackConnection1' },
        { from: 'xB_to:TrackConnection0', to: 'sB_out:TrackConnection1' },
        // nC_in (0,22000): sC_in.TC1 hub — 3-way switch
        { from: 'bypC:TrackConnection0', to: 'sC_in:TrackConnection1' },
        { from: 'outBC:TrackConnection1', to: 'sC_in:TrackConnection1' },
        { from: 'xC_from:TrackConnection1', to: 'sC_in:TrackConnection1' },
        // nC_out (0,26000): sC_out.TC1 hub (topArc1 auto-connected)
        { from: 'bypC:TrackConnection1', to: 'sC_out:TrackConnection1' },
        // Return junctions (retN+1 auto-connected via chaining)
        { from: 'xC_from:TrackConnection0', to: 'ret1:TrackConnection1' },
        { from: 'xB_to:TrackConnection1', to: 'ret2:TrackConnection1' },
        { from: 'xB_from:TrackConnection0', to: 'ret3:TrackConnection1' },
        { from: 'xA_to:TrackConnection1', to: 'ret4:TrackConnection1' },
      ],
    });

    // --- Assertions ---

    // 3 stations + 24 tracks = 27 entities minimum
    assert(r.added.length >= 27, `Expected >= 27 entities, got ${r.added.length}`);

    // All track IDs exist
    const trackIds = [
      'sA_in', 'sA_out', 'sB_in', 'sB_out', 'sC_in', 'sC_out',
      'bypA', 'bypB', 'bypC', 'outAB', 'outBC',
      'xA_to', 'xB_from', 'xB_to', 'xC_from',
      'topArc1', 'topArc2', 'ret1', 'ret2', 'ret3', 'ret4', 'ret5',
      'botArc1', 'botArc2',
    ];
    for (const id of trackIds) {
      assert(r.added.find(a => a.id === id), `Track ${id} should exist`);
    }

    const stA = added(r, 'stA');
    const stB = added(r, 'stB');
    const stC = added(r, 'stC');

    // Station positions
    assertApprox(stA.entity.transform.translation.y, 0, 10, 'StA Y');
    assertApprox(stB.entity.transform.translation.y, 12000, 10, 'StB Y');
    assertApprox(stC.entity.transform.translation.y, 24000, 10, 'StC Y');

    // Stub connections to stations
    const sA_in = getBuilder(r.added.find(a => a.id === 'sA_in').index);
    const sA_out = getBuilder(r.added.find(a => a.id === 'sA_out').index);
    const sB_in = getBuilder(r.added.find(a => a.id === 'sB_in').index);
    const sB_out = getBuilder(r.added.find(a => a.id === 'sB_out').index);
    const sC_in = getBuilder(r.added.find(a => a.id === 'sC_in').index);
    const sC_out = getBuilder(r.added.find(a => a.id === 'sC_out').index);

    assertConnected(sA_in, 'TrackConnection0', stA, 'TrackConnection1', 'sA_in→stA:TC1');
    assertConnected(sA_out, 'TrackConnection0', stA, 'TrackConnection0', 'sA_out→stA:TC0');
    assertConnected(sB_in, 'TrackConnection0', stB, 'TrackConnection1', 'sB_in→stB:TC1');
    assertConnected(sB_out, 'TrackConnection0', stB, 'TrackConnection0', 'sB_out→stB:TC0');
    assertConnected(sC_in, 'TrackConnection0', stC, 'TrackConnection1', 'sC_in→stC:TC1');
    assertConnected(sC_out, 'TrackConnection0', stC, 'TrackConnection0', 'sC_out→stC:TC0');

    // Verify 3-way switches (nA_out, nB_in, nB_out, nC_in should have 3 connections)
    const { getSaveState } = require('../../../viewer/lib/saveManager');
    const allObjects = getSaveState().allObjects;
    function connCount(builder, portName) {
      const port = builder.port(portName);
      const comp = allObjects.find(o => o.instanceName === port.pathName);
      return comp?.properties?.mConnectedComponents?.values?.length || 0;
    }
    assert.strictEqual(connCount(sA_out, 'TrackConnection1'), 3, 'nA_out should be 3-way switch');
    assert.strictEqual(connCount(sB_in, 'TrackConnection1'), 3, 'nB_in should be 3-way switch');
    assert.strictEqual(connCount(sB_out, 'TrackConnection1'), 3, 'nB_out should be 3-way switch');
    assert.strictEqual(connCount(sC_in, 'TrackConnection1'), 3, 'nC_in should be 3-way switch');

    // Full loop: all 3 stations reachable with consistent integrated track direction
    const stAIdx = r.added.find(a => a.id === 'stA').index;
    const stBIdx = r.added.find(a => a.id === 'stB').index;
    const stCIdx = r.added.find(a => a.id === 'stC').index;
    assertTrackLoop([stAIdx, stBIdx, stCIdx], 'double-track railway');
  });
});
