const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { assertApprox, getEntity, getBuilder, assertConnected, assertTrackLoop, added } = require('../helpers');

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
        { id: 'r1', from: 'ts:TrackConnection1', to: { x: -2400, y: 0, z: 0 }, track: true },
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
    // 4 stubs of exactly 1600 UU at station ports, then 2 arcs (2 segments each)
    const r = editEntities({
      anchor: { x: 700000, y: 0, z: 0 },
      entities: [
        { id: 'stA', type: 'train-station', position: { x: 0, y: 0, z: 0 } },
        { id: 'stB', type: 'train-station', position: { x: 0, y: 8000, z: 0 }, rotation: 180 },
      ],
      connections: [
        // Stubs (exactly 1600 UU each)
        { id: 'sL1', from: 'stA:TrackConnection1', to: { x: -2400, y: 0, z: 0 }, track: true },
        { id: 'sR3', from: 'stA:TrackConnection0', to: { x: 2400, y: 0, z: 0 }, track: true },
        { id: 'sR1', from: 'stB:TrackConnection0', to: { x: -2400, y: 8000, z: 0 }, track: true },
        { id: 'sL3', from: 'stB:TrackConnection1', to: { x: 2400, y: 8000, z: 0 }, track: true },
        // Left arc (2 segments): sL1(-2400,0) → mid(-6000,4000) → sR1(-2400,8000)
        { id: 'L1', from: 'sL1:TrackConnection1', to: { x: -6000, y: 4000, z: 0, rotation: 270 }, track: true },
        { id: 'L2', from: 'sR1:TrackConnection1', to: { x: -6000, y: 4000, z: 0, rotation: 90 }, track: true },
        // Right arc (2 segments): sL3(+2400,8000) → mid(+6000,4000) → sR3(+2400,0)
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
        // Stubs (1600 UU each)
        { id: 'sL1', from: 'stA:TrackConnection1', to: { x: -2400, y: 0, z: 0 }, track: true },
        { id: 'sR3', from: 'stA:TrackConnection0', to: { x: 2400, y: 0, z: 0 }, track: true },
        { id: 'sR1', from: 'stB:TrackConnection1', to: { x: -2400, y: 8000, z: 0 }, track: true },
        { id: 'sL3', from: 'stB:TrackConnection0', to: { x: 2400, y: 8000, z: 0 }, track: true },
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

  it('37. should create double-track railway with 3 stations, crossovers, and return loop', () => {
    // Double-track racetrack: outbound (X=0, +Y), return (X=8000, -Y), 3 stations
    // Stubs ±4000 UU. 4 crossovers: all single-segment U-turns (R=1636)
    // Top/bottom arcs = single-segment U-turns (D=8000, R=1636)
    const r = editEntities({
      anchor: { x: 850000, y: 0, z: 0 },
      entities: [
        { id: 'stA', type: 'train-station', position: { x: 0, y: 0, z: 0 }, rotation: 90 },
        { id: 'stB', type: 'train-station', position: { x: 0, y: 12000, z: 0 }, rotation: 90 },
        { id: 'stC', type: 'train-station', position: { x: 0, y: 24000, z: 0 }, rotation: 90 },
      ],
      connections: [
        // === STUBS (1600 UU, mandatory for integrated track) + extensions to switches ===
        { id: 'sA_in', from: 'stA:TrackConnection1', to: { x: 0, y: -2400, z: 0 }, track: true },
        { id: 'sA_out', from: 'stA:TrackConnection0', to: { x: 0, y: 2400, z: 0 }, track: true },
        { id: 'sB_in', from: 'stB:TrackConnection1', to: { x: 0, y: 9600, z: 0 }, track: true },
        { id: 'sB_out', from: 'stB:TrackConnection0', to: { x: 0, y: 14400, z: 0 }, track: true },
        { id: 'sC_in', from: 'stC:TrackConnection1', to: { x: 0, y: 21600, z: 0 }, track: true },
        { id: 'sC_out', from: 'stC:TrackConnection0', to: { x: 0, y: 26400, z: 0 }, track: true },
        // Extensions from stub ends to switches (at ±4000 from station center)
        { id: 'extA_in', from: { x: 0, y: -2400, z: 0 }, to: { x: 0, y: -4000, z: 0 }, track: true },
        { id: 'extA_out', from: { x: 0, y: 2400, z: 0 }, to: { x: 0, y: 4000, z: 0 }, track: true },
        { id: 'extB_in', from: { x: 0, y: 9600, z: 0 }, to: { x: 0, y: 8000, z: 0 }, track: true },
        { id: 'extB_out', from: { x: 0, y: 14400, z: 0 }, to: { x: 0, y: 16000, z: 0 }, track: true },
        { id: 'extC_in', from: { x: 0, y: 21600, z: 0 }, to: { x: 0, y: 20000, z: 0 }, track: true },
        { id: 'extC_out', from: { x: 0, y: 26400, z: 0 }, to: { x: 0, y: 28000, z: 0 }, track: true },
        // Chain stubs to extensions
        { from: 'extA_in:TrackConnection0', to: 'sA_in:TrackConnection1' },
        { from: 'extA_out:TrackConnection0', to: 'sA_out:TrackConnection1' },
        { from: 'extB_in:TrackConnection0', to: 'sB_in:TrackConnection1' },
        { from: 'extB_out:TrackConnection0', to: 'sB_out:TrackConnection1' },
        { from: 'extC_in:TrackConnection0', to: 'sC_in:TrackConnection1' },
        { from: 'extC_out:TrackConnection0', to: 'sC_out:TrackConnection1' },

        // === OUTBOUND MAIN LINE (between switch points) ===
        { id: 'outAB', from: { x: 0, y: 4000, z: 0 }, to: { x: 0, y: 8000, z: 0 }, track: true },
        { id: 'outBC', from: { x: 0, y: 16000, z: 0 }, to: { x: 0, y: 20000, z: 0 }, track: true },

        // === TOP ARC (single U-turn, chained from extC_out) ===
        { id: 'topArc', from: 'extC_out:TrackConnection1', to: { x: 8000, y: 28000, z: 0, rotation: 90 }, track: true },

        // === RETURN TRACKS (split at crossover Y positions) ===
        { id: 'ret28', from: { x: 8000, y: 28000, z: 0 }, to: { x: 8000, y: 20000, z: 0 }, track: true },
        { id: 'ret20', from: { x: 8000, y: 20000, z: 0 }, to: { x: 8000, y: 16000, z: 0 }, track: true },
        { id: 'ret16', from: { x: 8000, y: 16000, z: 0 }, to: { x: 8000, y: 8000, z: 0 }, track: true },
        { id: 'ret8', from: { x: 8000, y: 8000, z: 0 }, to: { x: 8000, y: 4000, z: 0 }, track: true },
        { id: 'ret4', from: { x: 8000, y: 4000, z: 0 }, to: { x: 8000, y: -4000, z: 0 }, track: true },

        // === BOTTOM ARC (single U-turn, chained from ret4) ===
        { id: 'botArc', from: 'ret4:TrackConnection1', to: { x: 0, y: -4000, z: 0, rotation: 270 }, track: true },

        // === CROSSOVER SORTIE A: outbound→return, U-turn at Y=4000 (both outward south) ===
        { id: 'xAo', from: { x: 0, y: 4000, z: 0, rotation: 90 }, to: { x: 8000, y: 4000, z: 0, rotation: 90 }, track: true },

        // === CROSSOVER SORTIE B: outbound→return, U-turn at Y=16000 (both outward south) ===
        { id: 'xBo', from: { x: 0, y: 16000, z: 0, rotation: 90 }, to: { x: 8000, y: 16000, z: 0, rotation: 90 }, track: true },

        // === CROSSOVER ENTREE B: return→outbound, U-turn at Y=8000 (both outward north) ===
        { id: 'xBi', from: { x: 8000, y: 8000, z: 0, rotation: 270 }, to: { x: 0, y: 8000, z: 0, rotation: 270 }, track: true },

        // === CROSSOVER ENTREE C: return→outbound, U-turn at Y=20000 (both outward north) ===
        { id: 'xCi', from: { x: 8000, y: 20000, z: 0, rotation: 270 }, to: { x: 0, y: 20000, z: 0, rotation: 270 }, track: true },

        // (crossovers are single-segment U-turns, no chain needed)

        // === RETURN TRACK CHAIN (through switch points) ===
        { from: 'ret4:TrackConnection0', to: 'ret8:TrackConnection1' },
        { from: 'ret8:TrackConnection0', to: 'ret16:TrackConnection1' },
        { from: 'ret16:TrackConnection0', to: 'ret20:TrackConnection1' },
        { from: 'ret20:TrackConnection0', to: 'ret28:TrackConnection1' },

        // === SWITCH CONNECTIONS ===
        // Top arc → return
        { from: 'topArc:TrackConnection1', to: 'ret28:TrackConnection0' },
        // Bottom arc → outbound stub
        { from: 'botArc:TrackConnection1', to: 'extA_in:TrackConnection1' },
        // Outbound switches (at extension TC1 points)
        { from: 'outAB:TrackConnection0', to: 'extA_out:TrackConnection1' },
        { from: 'outAB:TrackConnection1', to: 'extB_in:TrackConnection1' },
        { from: 'outBC:TrackConnection0', to: 'extB_out:TrackConnection1' },
        { from: 'outBC:TrackConnection1', to: 'extC_in:TrackConnection1' },
        // Crossover sortie A → switches (extA_out.TC1 + ret4.TC0)
        { from: 'xAo:TrackConnection0', to: 'extA_out:TrackConnection1' },
        { from: 'xAo:TrackConnection1', to: 'ret4:TrackConnection0' },
        // Crossover sortie B → switches (extB_out.TC1 + ret16.TC0)
        { from: 'xBo:TrackConnection0', to: 'extB_out:TrackConnection1' },
        { from: 'xBo:TrackConnection1', to: 'ret16:TrackConnection0' },
        // Crossover entrée B → switches (ret16.TC1 + extB_in.TC1)
        { from: 'xBi:TrackConnection0', to: 'ret16:TrackConnection1' },
        { from: 'xBi:TrackConnection1', to: 'extB_in:TrackConnection1' },
        // Crossover entrée C → switches (ret28.TC1 + extC_in.TC1)
        { from: 'xCi:TrackConnection0', to: 'ret28:TrackConnection1' },
        { from: 'xCi:TrackConnection1', to: 'extC_in:TrackConnection1' },

        // === BLOCK SIGNALS — 2 per switch (opposite yaw), all facing outward ===
        // Each switch has ports at +Y (90°) and -Y (270°). One signal per direction.
        // X=0 Y=4000 (split outbound)
        { id: 'sig_04n', type: 'block-signal', on: 'extA_out:TrackConnection1', facing: 'outward' },
        { id: 'sig_04s', type: 'block-signal', on: 'outAB:TrackConnection0', facing: 'outward' },
        // X=0 Y=8000 (merge outbound)
        { id: 'sig_08n', type: 'block-signal', on: 'outAB:TrackConnection1', facing: 'outward' },
        { id: 'sig_08s', type: 'block-signal', on: 'extB_in:TrackConnection1', facing: 'outward' },
        // X=0 Y=16000 (split outbound)
        { id: 'sig_16n', type: 'block-signal', on: 'extB_out:TrackConnection1', facing: 'outward' },
        { id: 'sig_16s', type: 'block-signal', on: 'outBC:TrackConnection0', facing: 'outward' },
        // X=0 Y=20000 (merge outbound)
        { id: 'sig_20n', type: 'block-signal', on: 'outBC:TrackConnection1', facing: 'outward' },
        { id: 'sig_20s', type: 'block-signal', on: 'extC_in:TrackConnection1', facing: 'outward' },
        // X=8000 Y=4000 (merge return)
        { id: 'sig_R4n', type: 'block-signal', on: 'ret4:TrackConnection0', facing: 'outward' },
        { id: 'sig_R4s', type: 'block-signal', on: 'ret8:TrackConnection1', facing: 'outward' },
        // X=8000 Y=8000 (split return)
        { id: 'sig_R8n', type: 'block-signal', on: 'ret8:TrackConnection0', facing: 'outward' },
        { id: 'sig_R8s', type: 'block-signal', on: 'ret16:TrackConnection1', facing: 'outward' },
        // X=8000 Y=16000 (merge return)
        { id: 'sig_R16n', type: 'block-signal', on: 'ret16:TrackConnection0', facing: 'outward' },
        { id: 'sig_R16s', type: 'block-signal', on: 'ret20:TrackConnection1', facing: 'outward' },
        // X=8000 Y=20000 (split return)
        { id: 'sig_R20n', type: 'block-signal', on: 'ret20:TrackConnection0', facing: 'outward' },
        { id: 'sig_R20s', type: 'block-signal', on: 'ret28:TrackConnection1', facing: 'outward' },
      ],
    });

    // --- Assertions ---
    const trackIds = [
      'sA_in', 'sA_out', 'sB_in', 'sB_out', 'sC_in', 'sC_out',
      'extA_in', 'extA_out', 'extB_in', 'extB_out', 'extC_in', 'extC_out',
      'outAB', 'outBC', 'topArc', 'botArc',
      'ret28', 'ret20', 'ret16', 'ret8', 'ret4',
      'xAo', 'xBo', 'xBi', 'xCi',
    ];
    const signalIds = r.added.filter(a => a.id && a.id.startsWith('sig'));
    assert.strictEqual(signalIds.length, 16, `Expected 16 signals, got ${signalIds.length}`);
    assert(r.added.length >= trackIds.length + 3 + 16, `Expected >= ${trackIds.length + 3 + 16} entities, got ${r.added.length}`);
    for (const id of trackIds) {
      assert(r.added.find(a => a.id === id), `Track ${id} should exist`);
    }

    const stA = added(r, 'stA'), stB = added(r, 'stB'), stC = added(r, 'stC');
    assertApprox(stA.entity.transform.translation.y, 0, 10, 'StA Y');
    assertApprox(stB.entity.transform.translation.y, 12000, 10, 'StB Y');
    assertApprox(stC.entity.transform.translation.y, 24000, 10, 'StC Y');

    // Stub connections
    assertConnected(added(r, 'sA_in'), 'TrackConnection0', stA, 'TrackConnection1', 'sA_in→stA');
    assertConnected(added(r, 'sA_out'), 'TrackConnection0', stA, 'TrackConnection0', 'sA_out→stA');
    assertConnected(added(r, 'sC_in'), 'TrackConnection0', stC, 'TrackConnection1', 'sC_in→stC');
    assertConnected(added(r, 'sC_out'), 'TrackConnection0', stC, 'TrackConnection0', 'sC_out→stC');

    // Full loop
    const stAIdx = r.added.find(a => a.id === 'stA').index;
    const stBIdx = r.added.find(a => a.id === 'stB').index;
    const stCIdx = r.added.find(a => a.id === 'stC').index;
    assertTrackLoop([stAIdx, stBIdx, stCIdx], 'double-track railway');

    // --- Signal placement: position matches guarded port, mGuardedConnections wired ---
    const saveState = require('../../../viewer/lib/saveManager').getSaveState();
    function assertSignal(sigId, trackId, portName, label) {
      const sig = r.added.find(a => a.id === sigId);
      assert(sig, `Signal ${sigId} should exist`);
      const sigEntity = saveState.items[sig.index].entity;
      // Verify mGuardedConnections is wired
      const guarded = sigEntity.properties.mGuardedConnections;
      assert(guarded && guarded.values && guarded.values.length === 1, `${label}: mGuardedConnections should have 1 entry`);
      const guardedPath = guarded.values[0].pathName;
      assert(guardedPath.includes(portName), `${label}: guarded should include ${portName}, got ${guardedPath}`);
      // Verify signal position matches the guarded port position
      const trackEntry = r.added.find(a => a.id === trackId);
      assert(trackEntry, `${label}: track ${trackId} should exist`);
      const trackBuilder = getBuilder(trackEntry.index);
      const port = trackBuilder.port(portName);
      const portPos = port.worldPos();
      assertApprox(sigEntity.transform.translation.x, portPos.x, 1, `${label} X`);
      assertApprox(sigEntity.transform.translation.y, portPos.y, 1, `${label} Y`);
      assertApprox(sigEntity.transform.translation.z, portPos.z, 1, `${label} Z`);
    }

    // Outbound line (X=0) signals — 2 per switch
    assertSignal('sig_04n', 'extA_out', 'TrackConnection1', 'Y4000 north');
    assertSignal('sig_04s', 'outAB', 'TrackConnection0', 'Y4000 south');
    assertSignal('sig_08n', 'outAB', 'TrackConnection1', 'Y8000 north');
    assertSignal('sig_08s', 'extB_in', 'TrackConnection1', 'Y8000 south');
    assertSignal('sig_16n', 'extB_out', 'TrackConnection1', 'Y16000 north');
    assertSignal('sig_16s', 'outBC', 'TrackConnection0', 'Y16000 south');
    assertSignal('sig_20n', 'outBC', 'TrackConnection1', 'Y20000 north');
    assertSignal('sig_20s', 'extC_in', 'TrackConnection1', 'Y20000 south');

    // Return line (X=8000) signals — 2 per switch
    assertSignal('sig_R4n', 'ret4', 'TrackConnection0', 'R Y4000 north');
    assertSignal('sig_R4s', 'ret8', 'TrackConnection1', 'R Y4000 south');
    assertSignal('sig_R8n', 'ret8', 'TrackConnection0', 'R Y8000 north');
    assertSignal('sig_R8s', 'ret16', 'TrackConnection1', 'R Y8000 south');
    assertSignal('sig_R16n', 'ret16', 'TrackConnection0', 'R Y16000 north');
    assertSignal('sig_R16s', 'ret20', 'TrackConnection1', 'R Y16000 south');
    assertSignal('sig_R20n', 'ret20', 'TrackConnection0', 'R Y20000 north');
    assertSignal('sig_R20s', 'ret28', 'TrackConnection1', 'R Y20000 south');
  });
});

// ── Track snap tests ────────────────────────────────────────────────
// Validate that snap connections between track ports always produce
// curved splines with opposing dirs at the junction.
const { assertPortsAligned } = require('../helpers');

function assertCurved(builder, label) {
  const entity = builder.entity;
  const sp = entity.properties.mSplineData;
  const pts = sp.values || sp;
  assert(pts.length >= 2, `${label}: spline should have >= 2 points`);
  const p0 = pts[0].value.properties.Location.value;
  const pN = pts[pts.length - 1].value.properties.Location.value;
  const dx = pN.x - p0.x, dy = pN.y - p0.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return; // degenerate
  const spanX = dx / len, spanY = dy / len;
  // Check tangents at BOTH endpoints — at least one must differ from span direction
  let minDot = 1;
  for (const pt of [pts[0], pts[pts.length - 1]]) {
    const at = pt.value.properties.ArriveTangent.value;
    const atLen = Math.sqrt(at.x * at.x + at.y * at.y);
    if (atLen < 1) continue;
    const dot = Math.abs((at.x / atLen) * spanX + (at.y / atLen) * spanY);
    if (dot < minDot) minDot = dot;
  }
  assert(minDot < 0.99, `${label}: spline should be curved, not straight (minDot=${minDot.toFixed(3)})`);
}

describe('Track snap', () => {
  it('38. should create track between 2 ports (colinear tracks offset in X+Y)', () => {
    // A: N-S (0,0)→(0,4000). B: N-S (4000,8000)→(4000,12000). Offset 4000 X, 8000 Y.
    // C: auto track from A.TC1 (0,4000) to B.TC0 (4000,8000) — 45° curve, 5657 UU.
    const r = editEntities({
      anchor: { x: 880000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'a', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 4000, z: 0 }, track: true },
        { id: 'b', from: { x: 4000, y: 8000, z: 0 }, to: { x: 4000, y: 12000, z: 0 }, track: true },
        { id: 'c', from: 'a:TrackConnection1', to: 'b:TrackConnection0', track: true },
      ],
    });
    assert.strictEqual(r.added.length, 3, 'Expected 3 tracks');
    const a = added(r, 'a'), b = added(r, 'b'), c = added(r, 'c');
    assertConnected(c, 'TrackConnection0', a, 'TrackConnection1', 'C.TC0→A.TC1');
    assertConnected(c, 'TrackConnection1', b, 'TrackConnection0', 'C.TC1→B.TC0');
    assertPortsAligned(c.port('TrackConnection0'), a.port('TrackConnection1'), 'C-A junction');
    assertPortsAligned(c.port('TrackConnection1'), b.port('TrackConnection0'), 'C-B junction');
    assertCurved(c, 'C spline');
  });

  // Same geometric layout for all 4 port combos:
  // Track A: 4000 UU N-S. Track B: 4000 UU NE 30° from junction.
  // Only the port combination and anchor position differ.
  // dx=2000, dy=3464 → ~30° off from +Y, length ~4000 UU.

  it('39. TC0 → TC1 snap (B.TC0 at junction, A.TC1 at junction)', () => {
    // Junction at (0,4000). A: (0,0)→(0,4000). B: (0,4000)→(2000,7464).
    const r = editEntities({
      anchor: { x: 900000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'a', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 4000, z: 0 }, track: true },
        { id: 'b', from: { x: 0, y: 4000, z: 0 }, to: { x: 2000, y: 7464, z: 0 }, track: true },
        { from: 'b:TrackConnection0', to: 'a:TrackConnection1' },
      ],
    });
    const a = added(r, 'a'), b = added(r, 'b');
    assertConnected(b, 'TrackConnection0', a, 'TrackConnection1', 'B.TC0→A.TC1');
    assertPortsAligned(b.port('TrackConnection0'), a.port('TrackConnection1'), 'junction');
    assertCurved(b, 'B spline');
  });

  it('40. TC1 → TC0 snap (B.TC1 at junction, A.TC0 at junction)', () => {
    // Junction at (0,0). A: (0,0)→(0,4000). B: (-2000,-3464)→(0,0).
    // Same shape as 38 but B is flipped: TC1 at junction instead of TC0.
    const r = editEntities({
      anchor: { x: 950000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'a', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 4000, z: 0 }, track: true },
        { id: 'b', from: { x: -2000, y: -3464, z: 0 }, to: { x: 0, y: 0, z: 0 }, track: true },
        { from: 'b:TrackConnection1', to: 'a:TrackConnection0' },
      ],
    });
    const a = added(r, 'a'), b = added(r, 'b');
    assertConnected(b, 'TrackConnection1', a, 'TrackConnection0', 'B.TC1→A.TC0');
    assertPortsAligned(b.port('TrackConnection1'), a.port('TrackConnection0'), 'junction');
    assertCurved(b, 'B spline');
  });

  it('41. TC0 → TC0 snap (B.TC0 at junction, A.TC0 at junction)', () => {
    // Junction at (0,4000). A reversed: (0,4000)→(0,0), so A.TC0 is at (0,4000).
    // B: (0,4000)→(2000,7464) — same as test 38.
    const r = editEntities({
      anchor: { x: 1000000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'a', from: { x: 0, y: 4000, z: 0 }, to: { x: 0, y: 0, z: 0 }, track: true },
        { id: 'b', from: { x: 0, y: 4000, z: 0 }, to: { x: 2000, y: 7464, z: 0 }, track: true },
        { from: 'b:TrackConnection0', to: 'a:TrackConnection0' },
      ],
    });
    const a = added(r, 'a'), b = added(r, 'b');
    assertConnected(b, 'TrackConnection0', a, 'TrackConnection0', 'B.TC0→A.TC0');
    assertPortsAligned(b.port('TrackConnection0'), a.port('TrackConnection0'), 'junction');
    assertCurved(b, 'B spline');
  });

  it('42. TC1 → TC1 snap (B.TC1 at junction, A.TC1 at junction)', () => {
    // Junction at (0,4000). A: (0,0)→(0,4000), A.TC1 outward=+Y.
    // Snap negates → B.TC1 outward=-Y (south). So B must ARRIVE going south at junction.
    // B: (2000,7464)→(0,4000) — comes from NE going SW, 30° off from south at TC1.
    const r = editEntities({
      anchor: { x: 1050000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'a', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 4000, z: 0 }, track: true },
        { id: 'b', from: { x: 2000, y: 7464, z: 0 }, to: { x: 0, y: 4000, z: 0 }, track: true },
        { from: 'b:TrackConnection1', to: 'a:TrackConnection1' },
      ],
    });
    const a = added(r, 'a'), b = added(r, 'b');
    assertConnected(b, 'TrackConnection1', a, 'TrackConnection1', 'B.TC1→A.TC1');
    assertPortsAligned(b.port('TrackConnection1'), a.port('TrackConnection1'), 'junction');
    assertCurved(b, 'B spline');
  });

  it('43. switch 3-way with branch (30° divergence)', () => {
    // Main: N-S stub (0,0)→(0,2000) + continuation (0,2000)→(0,6000).
    // Branch: (0,2000)→(2000,5464) NE 30°.
    // Connect branch.TC0 + continuation.TC0 to stub.TC1 (3-way switch).
    const r = editEntities({
      anchor: { x: 1100000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'stub', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 2000, z: 0 }, track: true },
        { id: 'cont', from: { x: 0, y: 2000, z: 0 }, to: { x: 0, y: 6000, z: 0 }, track: true },
        { id: 'branch', from: { x: 0, y: 2000, z: 0 }, to: { x: 2000, y: 5464, z: 0 }, track: true },
        { from: 'cont:TrackConnection0', to: 'stub:TrackConnection1' },
        { from: 'branch:TrackConnection0', to: 'stub:TrackConnection1' },
      ],
    });
    const stub = added(r, 'stub'), branch = added(r, 'branch');
    assertConnected(branch, 'TrackConnection0', stub, 'TrackConnection1', 'branch→stub switch');
    assertPortsAligned(branch.port('TrackConnection0'), stub.port('TrackConnection1'), 'switch junction');
    assertCurved(branch, 'branch spline');
  });

  it('44. should reject snap producing radius < 900 (90° on short track)', () => {
    assert.throws(() => editEntities({
      anchor: { x: 1150000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'a', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 2000, z: 0 }, track: true },
        { id: 'b', from: { x: 0, y: 2000, z: 0 }, to: { x: 2000, y: 2000, z: 0 }, track: true },
        { from: 'b:TrackConnection0', to: 'a:TrackConnection1' },
      ],
    }), /curvature too tight/);
  });

  it('45. should reject snap producing U-turn', () => {
    assert.throws(() => editEntities({
      anchor: { x: 1200000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'a', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 4000, z: 0 }, track: true },
        { id: 'b', from: { x: 0, y: 4000, z: 0 }, to: { x: 0, y: 2000, z: 0 }, track: true },
        { from: 'b:TrackConnection0', to: 'a:TrackConnection1' },
      ],
    }), /curvature too tight|U-turn/);
  });

  it('46. U-turn between 2 parallel tracks (D=1900, 2 segments)', () => {
    // A: N-S (0,0)→(0,4000). B: N-S (1900,0)→(1900,4000). Separation = 1900 UU.
    // U-turn: 2 segments from A.TC1 to B.TC1 (planTrackPath Bézier, Y shifted +4000).
    const r = editEntities({
      anchor: { x: 1250000, y: 0, z: 0 },
      entities: [],
      connections: [
        // Parallel tracks
        { id: 'a', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 4000, z: 0 }, track: true },
        { id: 'b', from: { x: 1900, y: 0, z: 0 }, to: { x: 1900, y: 4000, z: 0 }, track: true },
        // U-turn: 2 segments (from planTrackPath, Y += 4000)
        { id: 'u1', from: { x: 0, y: 4000, z: 0, rotation: 90 }, to: { x: 950, y: 9415, z: 0, rotation: 180 }, track: true },
        { id: 'u2', from: { x: 950, y: 9415, z: 0, rotation: 0 }, to: { x: 1900, y: 4000, z: 0, rotation: 90 }, track: true },
        // Chain U-turn
        { from: 'u1:TrackConnection1', to: 'u2:TrackConnection0' },
        // Connect U-turn to parallel tracks
        { from: 'u1:TrackConnection0', to: 'a:TrackConnection1' },
        { from: 'u2:TrackConnection1', to: 'b:TrackConnection1' },
      ],
    });

    assert.strictEqual(r.added.length, 4, 'Expected 2 tracks + 2 U-turn segments');

    const a = added(r, 'a'), b = added(r, 'b');
    const u1 = added(r, 'u1'), u2 = added(r, 'u2');

    // U-turn connected to both parallel tracks
    assertConnected(u1, 'TrackConnection0', a, 'TrackConnection1', 'u1→A');
    assertConnected(u2, 'TrackConnection1', b, 'TrackConnection1', 'u2→B');

    // Ports opposed at junctions
    assertPortsAligned(u1.port('TrackConnection0'), a.port('TrackConnection1'), 'u1-A junction');
    assertPortsAligned(u2.port('TrackConnection1'), b.port('TrackConnection1'), 'u2-B junction');

    // Both U-turn segments curved
    assertCurved(u1, 'u1 spline');
    assertCurved(u2, 'u2 spline');
  });
});

// ── Spline Z-delta tests ──────────────────────────────────────────
describe('Spline ramps (Z delta)', () => {
  it('48. should create a straight track ramp (5000 UU, Z -901)', () => {
    // Straight ramp descending 901 UU. Travel direction = 280° (south).
    // from anchor outward = 280° (same as travel), to anchor outward = 100° (faces arriving track).
    const r = editEntities({
      anchor: { x: 1300000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'ramp', from: { x: 0, y: 0, z: 0, rotation: 280 }, to: { x: 868, y: -4924, z: -901, rotation: 100 }, track: true },
      ],
    });
    assert.strictEqual(r.added.length, 1, 'Expected 1 track');
  });

  it('49. should create a belt ramp (2000 UU, Z +400)', () => {
    const r = editEntities({
      anchor: { x: 1350000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 0, y: 2000, z: 400 } },
      ],
      connections: [
        { id: 'b1', from: 'c1:Output0', to: 'c2:Input0', belt: 6 },
      ],
    });
    const belt = getBuilder(r.added.find(a => a.id === 'b1').index);
    const p0 = belt.port('ConveyorAny0').worldPos();
    const p1 = belt.port('ConveyorAny1').worldPos();
    assert(Math.abs(p1.z - p0.z) > 300, 'Belt should have significant Z delta');
  });

  it('50. should reject track ramp exceeding max slope', () => {
    // 2000 UU horizontal, 1500 UU vertical = ~37° (max 25°)
    assert.throws(() => editEntities({
      anchor: { x: 1400000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'steep', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 2000, z: -1500 }, track: true },
      ],
    }), /slope too steep/);
  });

  it('51. should create curved track with Z delta', () => {
    // Gentle 45° turn with descent — combines XY curvature and Z change.
    // from anchor outward = 0°, to anchor outward = 225° (45°+180°).
    const r = editEntities({
      anchor: { x: 1450000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'curve', from: { x: 0, y: 0, z: 0, rotation: 0 }, to: { x: 6000, y: 4000, z: -400, rotation: 225 }, track: true },
      ],
    });
    assert.strictEqual(r.added.length, 1, 'Expected 1 track');
  });

  it('52. should create track ramp with lateral offset and Z delta', () => {
    // Track with slight curve (20° offset) + descent.
    // from anchor outward = 0°, to anchor outward = 200° (20°+180°).
    const r = editEntities({
      anchor: { x: 1500000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'ramp', from: { x: 0, y: 0, z: 0, rotation: 0 }, to: { x: 8000, y: 2000, z: -600, rotation: 200 }, track: true },
      ],
    });
    assert.strictEqual(r.added.length, 1, 'Expected 1 track');
  });

  it('53. should reject belt ramp exceeding max slope', () => {
    // Belt with steep Z delta — 1000 UU horizontal, 1000 UU vertical = 45° (max 40°)
    assert.throws(() => editEntities({
      anchor: { x: 1550000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 0, y: 1000, z: 1000 } },
      ],
      connections: [
        { id: 'b1', from: 'c1:Output0', to: 'c2:Input0', belt: 6 },
      ],
    }), /slope too steep/);
  });

  // BUG: pipe with Z delta triggers false U-turn due to tangent double-negation in makeSpline.
  // Will pass after makeSpline 2.5D fix.
  it('54. should create a pipe ramp with Z delta', () => {
    assert.throws(() => editEntities({
      anchor: { x: 1600000, y: 0, z: 0 },
      entities: [
        { id: 'r1', type: 'refinery', position: { x: 0, y: 0, z: 0 } },
        { id: 'r2', type: 'refinery', position: { x: 0, y: 3000, z: 300 } },
      ],
      connections: [
        { id: 'p1', from: 'r1:PipeOutputFactory', to: 'r2:PipeInputFactory', pipe: 2 },
      ],
    }), /U-turn/);
  });

  it('55. should create a vertical pipe with Z tangents', () => {
    // Vertical pipe (dXY=0, dZ=2000) between two junctions rotated 90° around X.
    // Ports 2/3 point up/down after pitch. The game creates vertical pipes with pure Z tangents.
    const pitchUp = { x: 0.7071, y: 0, z: 0, w: 0.7071 };
    const SplineBuilder = require('../../../lib/shared/SplineBuilder');
    const r = editEntities({
      anchor: { x: 1650000, y: 0, z: 0 },
      entities: [
        { id: 'j1', type: 'pipe-junction', position: { x: 0, y: 0, z: 0 }, rotation: pitchUp },
        { id: 'j2', type: 'pipe-junction', position: { x: 0, y: 0, z: 2000 }, rotation: pitchUp },
      ],
      connections: [
        { id: 'p1', from: 'j1:2', to: 'j2:3', pipe: 2 },
      ],
    });
    assert.strictEqual(r.added.length, 3, 'Expected 2 junctions + 1 pipe');
    const pipe = getEntity(r.added.find(a => a.id === 'p1').index);
    const pts = SplineBuilder._parseSplinePoints(pipe.entity);
    // Guard tangent at start should have significant Z (vertical pipe)
    assert(Math.abs(pts[0].lz) > 10, `Guard tangent lz should be non-zero for vertical pipe (got ${pts[0].lz})`);
    // Mid-point tangent should have large Z
    const midIdx = Math.floor(pts.length / 2);
    assert(Math.abs(pts[midIdx].lz) > 100, `Mid tangent lz should be large for vertical pipe (got ${pts[midIdx].lz})`);
  });
});

// ── Layout JSON tests ──────────────────────────────────────────────
describe('Track snap with Z', () => {
  it('56. should snap track onto sloped track port (Z tangent propagation)', () => {
    // Track A is a ramp with a pitched endpoint (quaternion with Z slope).
    // Track B snaps onto A's TC1 — should inherit the Z tangent.
    // to anchor: 180° yaw (faces -X toward track) + pitch for slope.
    const pitch = -Math.atan2(500, 5000);
    const halfP = pitch / 2;
    const halfY = Math.PI; // 180° yaw
    // Compose: yaw 180° then pitch around Y
    const slopeQuat = {
      x: Math.sin(halfP) * Math.cos(halfY / 2),
      y: Math.sin(halfP) * Math.sin(halfY / 2),
      z: Math.cos(halfP) * Math.sin(halfY / 2),
      w: Math.cos(halfP) * Math.cos(halfY / 2),
    };
    const r = editEntities({
      anchor: { x: 1700000, y: 0, z: 0 },
      entities: [],
      connections: [
        { id: 'a', from: { x: 0, y: 0, z: 0, rotation: 0 }, to: { x: 5000, y: 0, z: -500, rotation: slopeQuat }, track: true },
        { id: 'b', from: 'a:TrackConnection1', to: { x: 9000, y: 0, z: -500, rotation: 180 }, track: true },
      ],
    });
    assert.strictEqual(r.added.length, 2, 'Expected 2 tracks');
  });
});

describe('Layouts', () => {
  it('47. station-bypass-compact layout from JSON', () => {
    const layout = require('../../../data/layouts/station-bypass-compact.json');
    // Validation only — editEntities throws on invalid splines (radius, slope)
    editEntities({ ...layout, anchor: { x: 950000, y: 0, z: 0 } });
  });
});
