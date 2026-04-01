const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { assertApprox, assertPortsAligned, assertLiftTopCardinal, getBuilder, added } = require('../helpers');

describe('Blueprint', () => {
  it('30. should stack 3 constructors with shared input (splitter+lifts) and shared output (merger+lifts)', () => {
    // c1 at z=0, c2 at z=1000 (rot 180°), c3 at z=2000 (same as c1)
    // Alternating rotation keeps ports vertically aligned
    const r1 = editEntities({
      anchor: { x: 300000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 1000 }, rotation: 180 },
        { id: 'c3', type: 'constructor', position: { x: 0, y: 0, z: 2000 } },
      ],
    });
    const c1Idx = added(r1, 'c1').entity.saveIndex;
    const c2Idx = added(r1, 'c2').entity.saveIndex;
    const c3Idx = added(r1, 'c3').entity.saveIndex;

    // ── INPUT SIDE: splitter → 3 branches ──

    // Splitter + belt → c1:Input0
    const r2 = editEntities({
      anchor: { x: 300000, y: 0, z: 0 },
      entities: [
        { id: 'spl', type: 'splitter', position: { x: 0, y: -800, z: 0 } },
        { id: 'c1', index: c1Idx },
      ],
      connections: [{ from: 'spl:Output1', to: 'c1:Input0', belt: 6 }],
    });
    const splIdx = added(r2, 'spl').entity.saveIndex;

    // Lift → c2:Input0 (height = 1100: spl at z=0, c2:Input0 at z=1100)
    const r3 = editEntities({
      entities: [
        { id: 'spl', index: splIdx },
        { id: 'liftIn1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 1100 } },
      ],
      connections: [{ from: 'liftIn1:bottom', to: 'spl:Output2' }],
    });
    const liftIn1Idx = added(r3, 'liftIn1').entity.saveIndex;

    editEntities({
      entities: [
        { id: 'liftIn1', index: liftIn1Idx },
        { id: 'c2', index: c2Idx },
      ],
      connections: [{ from: 'liftIn1:top', to: 'c2:Input0', belt: 6 }],
    });

    // Lift → c3:Input0 (height = 2100: spl at z=0, c3:Input0 at z=2100)
    const r5 = editEntities({
      entities: [
        { id: 'spl', index: splIdx },
        { id: 'liftIn2', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 2100 } },
      ],
      connections: [{ from: 'liftIn2:bottom', to: 'spl:Output3' }],
    });
    const liftIn2Idx = added(r5, 'liftIn2').entity.saveIndex;

    editEntities({
      entities: [
        { id: 'liftIn2', index: liftIn2Idx },
        { id: 'c3', index: c3Idx },
      ],
      connections: [{ from: 'liftIn2:top', to: 'c3:Input0', belt: 6 }],
    });

    // ── OUTPUT SIDE: merger collects 3 branches ──

    // Merger + belt from c1:Output0
    const r7 = editEntities({
      anchor: { x: 300000, y: 0, z: 0 },
      entities: [
        { id: 'c1', index: c1Idx },
        { id: 'mrg', type: 'merger', position: { x: 0, y: 800, z: 0 } },
      ],
      connections: [{ from: 'c1:Output0', to: 'mrg:Input1', belt: 6 }],
    });
    const mrgIdx = added(r7, 'mrg').entity.saveIndex;

    // Lift from merger:Input2 → c2:Output0
    const r8 = editEntities({
      entities: [
        { id: 'mrg', index: mrgIdx },
        { id: 'liftOut1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 1100 } },
      ],
      connections: [{ from: 'liftOut1:bottom', to: 'mrg:Input2' }],
    });
    const liftOut1Idx = added(r8, 'liftOut1').entity.saveIndex;

    editEntities({
      entities: [
        { id: 'c2', index: c2Idx },
        { id: 'liftOut1', index: liftOut1Idx },
      ],
      connections: [{ from: 'c2:Output0', to: 'liftOut1:top', belt: 6 }],
    });

    // Lift from merger:Input3 → c3:Output0
    const r10 = editEntities({
      entities: [
        { id: 'mrg', index: mrgIdx },
        { id: 'liftOut2', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 2100 } },
      ],
      connections: [{ from: 'liftOut2:bottom', to: 'mrg:Input3' }],
    });
    const liftOut2Idx = added(r10, 'liftOut2').entity.saveIndex;

    editEntities({
      entities: [
        { id: 'c3', index: c3Idx },
        { id: 'liftOut2', index: liftOut2Idx },
      ],
      connections: [{ from: 'c3:Output0', to: 'liftOut2:top', belt: 6 }],
    });

    // ── Verify ──
    const c2 = getBuilder(c2Idx);
    const c3 = getBuilder(c3Idx);
    const spl = getBuilder(splIdx);
    const mrg = getBuilder(mrgIdx);
    const liftIn1 = getBuilder(liftIn1Idx);
    const liftIn2 = getBuilder(liftIn2Idx);
    const liftOut1 = getBuilder(liftOut1Idx);
    const liftOut2 = getBuilder(liftOut2Idx);

    // Input lifts snapped to splitter outputs
    assertPortsAligned(liftIn1.port('bottom'), spl.port('Output2'), 'liftIn1:bottom ↔ spl:Output2');
    assertPortsAligned(liftIn2.port('bottom'), spl.port('Output3'), 'liftIn2:bottom ↔ spl:Output3');

    // Output lifts snapped to merger inputs
    assertPortsAligned(liftOut1.port('bottom'), mrg.port('Input2'), 'liftOut1:bottom ↔ mrg:Input2');
    assertPortsAligned(liftOut2.port('bottom'), mrg.port('Input3'), 'liftOut2:bottom ↔ mrg:Input3');

    // All lift tops cardinal
    assertLiftTopCardinal(liftIn1);
    assertLiftTopCardinal(liftIn2);
    assertLiftTopCardinal(liftOut1);
    assertLiftTopCardinal(liftOut2);

    // Lift tops at the right heights
    assertApprox(liftIn1.port('top').worldPos().z, c2.port('Input0').worldPos().z, 2, 'liftIn1 top Z ↔ c2:Input0 Z');
    assertApprox(liftIn2.port('top').worldPos().z, c3.port('Input0').worldPos().z, 2, 'liftIn2 top Z ↔ c3:Input0 Z');
    assertApprox(liftOut1.port('top').worldPos().z, c2.port('Output0').worldPos().z, 2, 'liftOut1 top Z ↔ c2:Output0 Z');
    assertApprox(liftOut2.port('top').worldPos().z, c3.port('Output0').worldPos().z, 2, 'liftOut2 top Z ↔ c3:Output0 Z');
  });
});
