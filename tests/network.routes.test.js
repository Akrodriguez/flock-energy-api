
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');

  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function makeMeter(meterId, hierarchy) {
  return { meterId, hierarchy };
}

function fixtureStore(meters) {
  return {
    getAll: async () => ({
      meters,
      fetchedAt: '2026-10-29T00:00:00.000Z',
    }),
  };
}

const common = () => [
  { level: 'zone', code: 'Z1', name: 'Zone 1' },
  { level: 'circle', code: 'C1', name: 'Circle 1' },
  { level: 'division', code: 'D1', name: 'Division 1' },
  { level: 'subdivision', code: 'SD1', name: 'Subdivision 1' },
  { level: 'substation', code: 'SS1', name: 'Substation 1' },
  { level: 'feeder', code: 'F1', name: 'Feeder 1' },
  { level: 'dt', code: 'DT1', name: 'Transformer 1' },
];

test('transformer listing groups meters and reports meter counts', async () => {
  const hierarchy = common();
  const app = createApp({ meterStore: fixtureStore([
    makeMeter('M1', hierarchy),
    makeMeter('M2', hierarchy),
  ]) });

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/transformers`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.total, 1);
    assert.equal(body.items[0].code, 'DT1');
    assert.equal(body.items[0].meterCount, 2);
    assert.deepEqual(body.items[0].names, ['Transformer 1']);
  });
});

test('same transformer code under different feeder paths stays separate', async () => {
  const first = common();
  const second = common().map((node) =>
    node.level === 'feeder'
      ? { ...node, code: 'F2', name: 'Feeder 2' }
      : node,
  );

  const app = createApp({ meterStore: fixtureStore([
    makeMeter('M1', first),
    makeMeter('M2', second),
  ]) });

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/transformers`);
    const body = await response.json();

    assert.equal(body.total, 2);
    assert.deepEqual(
      body.items.map((item) => item.hierarchy.at(-1).code).sort(),
      ['F1', 'F2'],
    );
  });
});

test('transformer detail returns 409 when a code is ambiguous', async () => {
  const first = common();
  const second = common().map((node) =>
    node.level === 'feeder'
      ? { ...node, code: 'F2', name: 'Feeder 2' }
      : node,
  );

  const app = createApp({ meterStore: fixtureStore([
    makeMeter('M1', first),
    makeMeter('M2', second),
  ]) });

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/transformers/DT1`);
    assert.equal(response.status, 409);
    assert.equal(
      (await response.json()).error.code,
      'AMBIGUOUS_TRANSFORMER_CODE',
    );
  });
});

test('transformer detail returns 404 for an unknown code', async () => {
  const app = createApp({ meterStore: fixtureStore([
    makeMeter('M1', common()),
  ]) });

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/transformers/MISSING`);
    assert.equal(response.status, 404);
    assert.equal(
      (await response.json()).error.code,
      'TRANSFORMER_NOT_FOUND',
    );
  });
});

test('hierarchy returns the cached tree with meter counts', async () => {
  const app = createApp({ meterStore: fixtureStore([
    makeMeter('M1', common()),
    makeMeter('M2', common()),
  ]) });

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/hierarchy`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].code, 'Z1');
    assert.equal(body.data[0].meterCount, 2);
    assert.equal(body.data[0].children[0].code, 'C1');
  });
});
