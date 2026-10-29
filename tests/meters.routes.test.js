
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
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function createTestApp(overrides = {}) {
  const meterStore = {
    list: async () => ({
      items: [{ meterId: 'J100001' }],
      total: 1,
      page: 1,
      pageSize: 20,
      fetchedAt: '2026-10-29T00:00:00.000Z',
    }),
    get: async (meterId) =>
      meterId === 'J100001' ? { meterId: 'J100001' } : null,
    ...overrides,
  };

  return createApp({ meterStore });
}

test('GET /api/v1/meters returns a paginated result', async () => {
  await withServer(createTestApp(), async (base) => {
    const response = await fetch(`${base}/api/v1/meters`);
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.total, 1);
    assert.deepEqual(body.items, [{ meterId: 'J100001' }]);
  });
});

test('meter list forwards supported filters and pagination', async () => {
  let received;
  const app = createTestApp({
    list: async (params) => {
      received = params;
      return { items: [], total: 0, page: params.page, pageSize: params.pageSize };
    },
  });

  await withServer(app, async (base) => {
    const response = await fetch(
      `${base}/api/v1/meters?q=J100&status=Installed&page=2&pageSize=10`,
    );

    assert.equal(response.status, 200);
    assert.equal(received.q, 'J100');
    assert.equal(received.status, 'Installed');
    assert.equal(received.page, 2);
    assert.equal(received.pageSize, 10);
  });
});

test('invalid pagination returns a validation error', async () => {
  await withServer(createTestApp(), async (base) => {
    const response = await fetch(`${base}/api/v1/meters?page=0`);
    assert.equal(response.status, 400);

    const body = await response.json();
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });
});

test('GET /api/v1/meters/:meterId returns the meter', async () => {
  await withServer(createTestApp(), async (base) => {
    const response = await fetch(`${base}/api/v1/meters/J100001`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      data: { meterId: 'J100001' },
    });
  });
});

test('unknown meter ID returns 404', async () => {
  await withServer(createTestApp(), async (base) => {
    const response = await fetch(`${base}/api/v1/meters/UNKNOWN`);
    assert.equal(response.status, 404);

    const body = await response.json();
    assert.equal(body.error.code, 'METER_NOT_FOUND');
  });
});

test('invalid meter ID returns 400', async () => {
  await withServer(createTestApp(), async (base) => {
    const response = await fetch(`${base}/api/v1/meters/%2F`);
    assert.equal(response.status, 400);
  });
});

test('store failures use the standard internal error envelope', async () => {
  const app = createTestApp({
    list: async () => {
      throw new Error('internal test detail');
    },
  });

  await withServer(app, async (base) => {
    const response = await fetch(`${base}/api/v1/meters`);
    assert.equal(response.status, 500);

    const body = await response.json();
    assert.deepEqual(body, {
      error: {
        code: 'INTERNAL',
        message: 'Internal server error',
      },
    });
    assert.equal(JSON.stringify(body).includes('internal test detail'), false);
  });
});
