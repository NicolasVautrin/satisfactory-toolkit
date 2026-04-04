const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { assertApprox, assertPortsAligned, assertLiftTopCardinal, getBuilder, added } = require('../helpers');

describe('Blueprint', () => {
  it('30. should stack 3 constructors with shared input (splitter+lifts) and shared output (merger+lifts)', () => {
    // All constructors face +Y (Output0) / -Y (Input0), stacked in Z.
    // Splitter rot 90°: Output1→+Y, Output2→-X, Output3→+X
    // Merger rot 90°: Input1→-Y, Input2→-X, Input3→+X
    // c2/c3 offset in X to align with lift tops.
    //
    // Lift rotation after snap (bottom local = +X, wOpposed = -anchorDir):
    //   snap -X port → wOpposed +X → entity rot 0° (identity)
    //   snap +X port → wOpposed -X → entity rot 180°
    //
    // TopDir (entity-local) → world direction:
    //   liftIn1  rot 0°:   RIGHT {0,1}  → world +Y (toward c2)
    //   liftIn2  rot 180°: LEFT  {0,-1} → world +Y (toward c3)
    //   liftOut1 rot 0°:   LEFT  {0,-1} → world -Y (toward c2)
    //   liftOut2 rot 180°: RIGHT {0,1}  → world -Y (toward c3)
    const r = editEntities({
      anchor: { x: 300000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: -400, y: 0, z: 1000 } },
        { id: 'c3', type: 'constructor', position: { x: 400, y: 0, z: 2000 } },
        { id: 'spl', type: 'splitter', position: { x: 0, y: -1000, z: 0 }, rotation: 90 },
        { id: 'mrg', type: 'merger', position: { x: 0, y: 1000, z: 0 }, rotation: 90 },
        { id: 'liftIn1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 1100, topDir: { x: 0, y: 1 } } },
        { id: 'liftIn2', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 2100, topDir: { x: 0, y: -1 } } },
        { id: 'liftOut1', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 1100, topDir: { x: 0, y: -1 } } },
        { id: 'liftOut2', type: 'lift', position: { x: 0, y: 0, z: 0 }, properties: { height: 2100, topDir: { x: 0, y: 1 } } },
      ],
      connections: [
        // Input side
        { id: 'b1', from: 'spl:Output1', to: 'c1:Input0', belt: 6 },
        { from: 'liftIn1:bottom', to: 'spl:Output2' },
        { id: 'b2', from: 'liftIn1:top', to: 'c2:Input0', belt: 6 },
        { from: 'liftIn2:bottom', to: 'spl:Output3' },
        { id: 'b3', from: 'liftIn2:top', to: 'c3:Input0', belt: 6 },
        // Output side
        { id: 'b4', from: 'c1:Output0', to: 'mrg:Input1', belt: 6 },
        { from: 'liftOut1:bottom', to: 'mrg:Input2' },
        { id: 'b5', from: 'c2:Output0', to: 'liftOut1:top', belt: 6 },
        { from: 'liftOut2:bottom', to: 'mrg:Input3' },
        { id: 'b6', from: 'c3:Output0', to: 'liftOut2:top', belt: 6 },
      ],
    });

    // ── Verify ──
    const spl = getBuilder(added(r, 'spl').entity.saveIndex);
    const mrg = getBuilder(added(r, 'mrg').entity.saveIndex);
    const c2 = getBuilder(added(r, 'c2').entity.saveIndex);
    const c3 = getBuilder(added(r, 'c3').entity.saveIndex);
    const liftIn1 = getBuilder(added(r, 'liftIn1').entity.saveIndex);
    const liftIn2 = getBuilder(added(r, 'liftIn2').entity.saveIndex);
    const liftOut1 = getBuilder(added(r, 'liftOut1').entity.saveIndex);
    const liftOut2 = getBuilder(added(r, 'liftOut2').entity.saveIndex);

    assertPortsAligned(liftIn1.port('bottom'), spl.port('Output2'), 'liftIn1:bottom ↔ spl:Output2');
    assertPortsAligned(liftIn2.port('bottom'), spl.port('Output3'), 'liftIn2:bottom ↔ spl:Output3');
    assertPortsAligned(liftOut1.port('bottom'), mrg.port('Input2'), 'liftOut1:bottom ↔ mrg:Input2');
    assertPortsAligned(liftOut2.port('bottom'), mrg.port('Input3'), 'liftOut2:bottom ↔ mrg:Input3');

    assertLiftTopCardinal(liftIn1);
    assertLiftTopCardinal(liftIn2);
    assertLiftTopCardinal(liftOut1);
    assertLiftTopCardinal(liftOut2);

    assertApprox(liftIn1.port('top').worldPos().z, c2.port('Input0').worldPos().z, 10, 'liftIn1 top Z ↔ c2:Input0 Z');
    assertApprox(liftIn2.port('top').worldPos().z, c3.port('Input0').worldPos().z, 10, 'liftIn2 top Z ↔ c3:Input0 Z');
    assertApprox(liftOut1.port('top').worldPos().z, c2.port('Output0').worldPos().z, 10, 'liftOut1 top Z ↔ c2:Output0 Z');
    assertApprox(liftOut2.port('top').worldPos().z, c3.port('Output0').worldPos().z, 10, 'liftOut2 top Z ↔ c3:Output0 Z');
  });
});
