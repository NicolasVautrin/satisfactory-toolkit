const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { getEntity, added, splineMidpoint } = require('../helpers');

describe('Pipe', () => {
  it('15. should insert junction on pipe', () => {
    const r1 = editEntities({
      anchor: { x: 120000, y: 0, z: 0 },
      entities: [
        { id: 'p1', type: 'packager', position: { x: 0, y: 0, z: 0 } },
        { id: 'p2', type: 'packager', position: { x: 3000, y: 0, z: 0 } },
      ],
      connections: [{ from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 }],
    });
    const pipeIdx = r1.added.find(a => a.instanceName?.includes('Pipeline')).index;
    const mid = splineMidpoint(getEntity(pipeIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'pipe1', index: pipeIdx },
        { id: 'j1', type: 'pipe-junction' },
      ],
      connections: [{ from: 'j1', on: 'pipe1', position: mid }],
    });
    assert.strictEqual(r2.added.length, 2, 'Expected junction + pipe2');
    const j1 = added(r2, 'j1');
    assert(j1, 'Junction should exist');
  });

  it('16. should insert pump on pipe', () => {
    const r1 = editEntities({
      anchor: { x: 130000, y: 0, z: 0 },
      entities: [
        { id: 'p1', type: 'packager', position: { x: 0, y: 0, z: 0 } },
        { id: 'p2', type: 'packager', position: { x: 3000, y: 0, z: 0 } },
      ],
      connections: [{ from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 }],
    });
    const pipeIdx = r1.added.find(a => a.instanceName?.includes('Pipeline')).index;
    const mid = splineMidpoint(getEntity(pipeIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'pipe1', index: pipeIdx },
        { id: 'pump1', type: 'pipe-pump' },
      ],
      connections: [{ from: 'pump1', on: 'pipe1', position: mid }],
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
      connections: [{ from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 }],
    });
    const pipeIdx = r1.added.find(a => a.instanceName?.includes('Pipeline')).index;
    const mid = splineMidpoint(getEntity(pipeIdx).entity);

    const r2 = editEntities({
      entities: [
        { id: 'pipe1', index: pipeIdx },
        { id: 'pump1', type: 'pipe-pump' },
      ],
      connections: [{ from: 'pump1', on: 'pipe1', position: mid, reverse: true }],
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
      connections: [{ from: 'p1:PipeOutputFactory', to: 'p2:PipeInputFactory', pipe: 2 }],
    });
    const pipeIdx = r1.added.find(a => a.instanceName?.includes('Pipeline')).index;
    const mid = splineMidpoint(getEntity(pipeIdx).entity);

    assert.throws(() => {
      editEntities({
        entities: [
          { id: 'pipe1', index: pipeIdx },
          { id: 's1', type: 'splitter' },
        ],
        connections: [{ from: 's1', on: 'pipe1', position: mid }],
      });
    });
  });
});
