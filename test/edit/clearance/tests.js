const assert = require('assert');
const { editEntities } = require('../../../viewer/lib/editor');
const { getEntity } = require('../helpers');

describe('Clearance', () => {
  it('25. should detect intra-batch overlap', () => {
    assert.throws(() => {
      editEntities({
        anchor: { x: 200000, y: 0, z: 0 },
        entities: [
          { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
          { id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        ],
      });
    }, (err) => {
      assert(err.message.includes('Clearance overlap'), `Expected clearance error, got: ${err.message}`);
      assert(err.message.includes('intra-batch'), `Expected intra-batch source, got: ${err.message}`);
      return true;
    });
  });

  it('26. should accept constructors spaced apart', () => {
    const r = editEntities({
      anchor: { x: 210000, y: 0, z: 0 },
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 5000, y: 0, z: 0 } },
      ],
    });
    assert.strictEqual(r.added.length, 2);
  });

  it('27. should bypass overlap with skipClearance', () => {
    const r = editEntities({
      anchor: { x: 220000, y: 0, z: 0 },
      skipClearance: true,
      entities: [
        { id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
        { id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 0 } },
      ],
    });
    assert.strictEqual(r.added.length, 2);
  });

  it('28. should not self-collide when updating alias at same position', () => {
    const r1 = editEntities({
      anchor: { x: 230000, y: 0, z: 0 },
      entities: [{ id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } }],
    });
    const idx = r1.added[0].index;

    const r2 = editEntities({
      entities: [{ id: 'c1', index: idx, position: { x: 0, y: 0, z: 0 } }],
    });
    assert.strictEqual(r2.updated.length, 1);
  });

  it('29. should detect overlap with existing map entity', () => {
    editEntities({
      anchor: { x: 240000, y: 0, z: 0 },
      entities: [{ id: 'c1', type: 'constructor', position: { x: 0, y: 0, z: 0 } }],
    });

    assert.throws(() => {
      editEntities({
        anchor: { x: 240000, y: 0, z: 0 },
        entities: [{ id: 'c2', type: 'constructor', position: { x: 0, y: 0, z: 0 } }],
      });
    }, (err) => {
      assert(err.message.includes('Clearance overlap'), `Expected clearance error, got: ${err.message}`);
      assert(err.message.includes('map'), `Expected map source, got: ${err.message}`);
      return true;
    });
  });
});
