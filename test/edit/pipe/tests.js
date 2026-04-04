const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { getEntity, getBuilder, added, splineMidpoint, assertConnected } = require('../helpers');

describe('Pipe', () => {
  it('15. should insert junction on pipe', () => {
    const r1 = editEntities({
      anchor: { x: 120000, y: 0, z: 0 },
      entities: [
        { id: 'p1', type: 'packager', position: { x: 0, y: 0, z: 0 } },
        { id: 'p2', type: 'packager', position: { x: 3000, y: 0, z: 0 } },
      ],
      connections: [{ id: 'p1', from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 }],
    });
    const pipeIdx = r1.added.find(a => a.instanceName?.includes('Pipeline')).index;
    const mid = splineMidpoint(getEntity(pipeIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'pipe1', index: pipeIdx },
        { id: 'j1', type: 'pipe-junction' },
      ],
      connections: [{ id: 'sp2', from: 'j1', on: 'pipe1', position: mid }],
    });
    assert.strictEqual(r2.added.length, 2, 'Expected junction + pipe2');
    const j1 = added(r2, 'j1');

    // Verify connection chain: p1 → pipe1 → junction → pipe2 → p2
    const p1 = getBuilder(r1.added.find(a => a.id === 'p1').index);
    const p2 = getBuilder(r1.added.find(a => a.id === 'p2').index);
    const pipe1 = getBuilder(pipeIdx);
    const pipe2 = getBuilder(r2.added.find(a => a.id === 'sp2').index);
    assertConnected(p1, 'PipeOutputFactory', pipe1, 'PipelineConnection0', 'p1→pipe1');
    assertConnected(pipe1, 'PipelineConnection1', j1, '0', 'pipe1→junction');
    assertConnected(j1, '1', pipe2, 'PipelineConnection0', 'junction→pipe2');
    assertConnected(pipe2, 'PipelineConnection1', p2, 'PipeInputFactory', 'pipe2→p2');
  });

  it('16. should insert pump on pipe', () => {
    const r1 = editEntities({
      anchor: { x: 130000, y: 0, z: 0 },
      entities: [
        { id: 'p1', type: 'packager', position: { x: 0, y: 0, z: 0 } },
        { id: 'p2', type: 'packager', position: { x: 3000, y: 0, z: 0 } },
      ],
      connections: [{ id: 'p1', from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 }],
    });
    const pipeIdx = r1.added.find(a => a.instanceName?.includes('Pipeline')).index;
    const mid = splineMidpoint(getEntity(pipeIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'pipe1', index: pipeIdx },
        { id: 'pump1', type: 'pipe-pump' },
      ],
      connections: [{ id: 'sp2', from: 'pump1', on: 'pipe1', position: mid }],
    });
    assert.strictEqual(r2.added.length, 2, 'Expected pump + pipe2');
  });

  it('17. should insert pump on pipe with reverse', () => {
    const r1 = editEntities({
      anchor: { x: 140000, y: 0, z: 0 },
      entities: [
        { id: 'p1', type: 'packager', position: { x: 0, y: 0, z: 0 } },
        { id: 'p2', type: 'packager', position: { x: 3000, y: 0, z: 0 } },
      ],
      connections: [{ id: 'p1', from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 }],
    });
    const pipeIdx = r1.added.find(a => a.instanceName?.includes('Pipeline')).index;
    const mid = splineMidpoint(getEntity(pipeIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'pipe1', index: pipeIdx },
        { id: 'pump1', type: 'pipe-pump' },
      ],
      connections: [{ id: 'sp2', from: 'pump1', on: 'pipe1', position: mid, reverse: true }],
    });
    assert.strictEqual(r2.added.length, 2, 'Expected pump + pipe2');
  });

  it('18. should reject inserting splitter on pipe', () => {
    const r1 = editEntities({
      anchor: { x: 145000, y: 0, z: 0 },
      entities: [
        { id: 'p1', type: 'packager', position: { x: 0, y: 0, z: 0 } },
        { id: 'p2', type: 'packager', position: { x: 3000, y: 0, z: 0 } },
      ],
      connections: [{ id: 'p1', from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 }],
    });
    const pipeIdx = r1.added.find(a => a.instanceName?.includes('Pipeline')).index;
    const mid = splineMidpoint(getEntity(pipeIdx).entity);

    assert.throws(() => {
      editEntities({
        entities: [
          { id: 'pipe1', index: pipeIdx },
          { id: 's1', type: 'splitter' },
        ],
        connections: [{ id: 'sp2', from: 's1', on: 'pipe1', position: mid }],
      });
    });
  });

  it('32. should create pipe and insert junction in same edit', () => {
    const r = editEntities({
      anchor: { x: 550000, y: 0, z: 0 },
      entities: [
        { id: 'p1', type: 'packager', position: { x: 0, y: 0, z: 0 } },
        { id: 'p2', type: 'packager', position: { x: 0, y: 3000, z: 0 } },
        { id: 'j1', type: 'pipe-junction' },
      ],
      connections: [
        { id: 'pipe1', from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 },
        { id: 'pipe2', from: 'j1', on: 'pipe1', position: { x: 550000, y: 1500, z: 375 } },
      ],
    });
    const j1 = added(r, 'j1');
    const t = j1.entity.transform.translation;
    assert(t.y > 0 && t.y < 3600, `Junction y should be between pipe endpoints, got ${t.y}`);
    assert(r.added.length >= 4, `Expected p1 + p2 + j1 + pipe + new_spline, got ${r.added.length}`);

    // Verify connection chain: p1 → pipe1 → junction → pipe2 → p2
    const p1 = added(r, 'p1');
    const p2 = added(r, 'p2');
    const pipe1 = getBuilder(r.added.find(a => a.id === 'pipe1').index);
    const pipe2 = getBuilder(r.added.find(a => a.id === 'pipe2').index);
    assertConnected(p1, 'PipeOutputFactory', pipe1, 'PipelineConnection0', 'p1→pipe1');
    assertConnected(pipe1, 'PipelineConnection1', j1, '0', 'pipe1→junction');
    assertConnected(j1, '1', pipe2, 'PipelineConnection0', 'junction→pipe2');
    assertConnected(pipe2, 'PipelineConnection1', p2, 'PipeInputFactory', 'pipe2→p2');
  });
});
