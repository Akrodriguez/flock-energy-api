
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

function testApp({ meterExists = true, portalResponse } = {}) {
  const meterStore = {
    get: async () => meterExists ? { meterId: 'J100001' } : null,
  };

  const portalClient = {
    getJson: async () => portalResponse ?? {
      status: 200,
      data: {
        data: [{
          timestamp: '30/06/2026 23:30',
          kwh: '123.5',
          kvah: '130.2',
          voltR: '230.1',
        }],
      },
    },
  };

  return createApp({ config: {}, meterStore, portalClient });
}

test('consumption endpoint normalizes portal readings', async () => {
  await withServer(testApp(), async (base) => {
    const response = await fetch(
      `${base}/api/v1/meters/J100001/consumption`,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      meterId: 'J100001',
      count: 1,
      readings: [{
        timestamp: '2026-06-30T23:30:00',
        timestampRaw: '30/06/2026 23:30',
        kwh: 123.5,
        kvah: 130.2,
        voltageR: 230.1,
      }],
    });
  });
});

test('unknown meter returns 404 without requesting portal readings', async () => {
  let requested = false;
  const app = createApp({
    config: {},
    meterStore: { get: async () => null },
    portalClient: {
      getJson: async () => {
        requested = true;
        throw new Error('Should not be called');
      },
    },
  });

  await withServer(app, async (base) => {
    const response = await fetch(
      `${base}/api/v1/meters/J100001/consumption`,
    );

    assert.equal(response.status, 404);
    assert.equal((await response.json()).error.code, 'METER_NOT_FOUND');
    assert.equal(requested, false);
  });
});

test('invalid meter ID returns 400', async () => {
  await withServer(testApp(), async (base) => {
    const response = await fetch(
      `${base}/api/v1/meters/%2F/consumption`,
    );
    assert.equal(response.status, 400);
  });
});

test('portal 404 for a known meter becomes an upstream error', async () => {
  await withServer(testApp({
    portalResponse: {
      status: 404,
      data: { error: 'not_found', message: 'Meter not found' },
    },
  }), async (base) => {
    const response = await fetch(
      `${base}/api/v1/meters/J100001/consumption`,
    );

    assert.equal(response.status, 502);
    assert.equal(
      (await response.json()).error.code,
      'UPSTREAM_RESOURCE_NOT_FOUND',
    );
  });
});

test('malformed portal consumption data becomes an upstream error', async () => {
  await withServer(testApp({
    portalResponse: { status: 200, data: { data: 'invalid' } },
  }), async (base) => {
    const response = await fetch(
      `${base}/api/v1/meters/J100001/consumption`,
    );

    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'UPSTREAM_ERROR');
  });
});
