import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExport } from '../src/parsers/export.js';
import { MeterStore } from '../src/services/meterStore.js';
import { UpstreamError } from '../src/utils/errors.js';

// Trimmed from real portal rows (J100000, J100003, J100011, J100400); see PROTOCOL.md.
const lvl = (name, code) => ({ name, code });
const hierarchy = (over = {}) => ({
  zone: lvl('Jaipur Zone 1', 'Z-01'), circle: lvl('Circle 1', 'C-01'), division: lvl('Division 7', 'D-07'),
  subdivision: lvl('Subdivision 7', 'SD-07'), substation: lvl('Substation 7', 'SS-07'),
  feeder: lvl('Feeder 7', 'F-007'), dt: lvl('Sanganer DT 7', 'DT-007'), ...over,
});
const row = (meterId, over = {}) => ({
  meterId, serialNo: 'SE33962', make: 'HPL', phaseType: 'single', installStatus: 'Decommissioned',
  installType: 'Whole Current', build: 'legacy', dtCode: 'DT-007', hierarchy: hierarchy(),
  geo: { lat: 26.93, lng: 75.83 }, ...over,
});
const fixture = () => ({
  data: [
    row('J100000'),
    row('J100003', { serialNo: 'L&84997', make: 'Genus', installStatus: 'Installed' }),
    row('J100011', { serialNo: 'SE48422', hierarchy: hierarchy({ circle: lvl('Circle 6', '') }) }),
    row('J100400', { serialNo: 'GN31592', make: 'Genus', phaseType: 'three', installStatus: 'Installed',
      hierarchy: hierarchy({ dt: lvl('Old Malviya Nagar Xfmr', 'DT-007') }) }),
  ],
  total: 4,
});

test('export parsing: blanks become null with an issue, source values are kept', () => {
  const [, , blankCircle, conflict] = parseExport(fixture());
  assert.equal(blankCircle.hierarchy[1].code, null);
  assert.deepEqual(blankCircle.dataQuality.issues, ['hierarchy.circle.code missing']);
  assert.equal(conflict.hierarchy[6].name, 'Old Malviya Nagar Xfmr'); // DT-007 name clash preserved
  assert.deepEqual(conflict.location, { latitude: 26.93, longitude: 75.83 });
});

test('export parsing: out-of-range coordinates are nulled and flagged', () => {
  const [m] = parseExport({ data: [row('X1', { geo: { lat: 999, lng: 75 } })], total: 1 });
  assert.equal(m.location.latitude, null);
  assert.ok(m.dataQuality.issues.includes('location missing or out of range'));
});

test('export parsing: partial or malformed exports become 502', () => {
  assert.throws(() => parseExport({ data: [row('X1')], total: 5 }), (e) => e instanceof UpstreamError && e.status === 502);
  assert.throws(() => parseExport({ nope: true }), (e) => e.status === 502);
});

const fakeClient = (body = fixture()) => {
  const c = { calls: 0, getJson: async () => { c.calls++; return { status: 200, data: body }; } };
  return c;
};

test('store loads once within the TTL and shares concurrent loads', async () => {
  const client = fakeClient();
  const store = new MeterStore(client, { ttlMs: 1000, now: () => 0 });
  await Promise.all([store.list(), store.list(), store.get('J100000')]);
  await store.list();
  assert.equal(client.calls, 1);
});

test('store refreshes after the TTL expires', async () => {
  const client = fakeClient();
  let t = 0;
  const store = new MeterStore(client, { ttlMs: 1000, now: () => t });
  await store.list();
  t = 1001;
  await store.list();
  assert.equal(client.calls, 2);
});

test('list: substring search on id/serial (incl. ampersand), filters, paging, empty result', async () => {
  const store = new MeterStore(fakeClient());
  assert.deepEqual((await store.list({ q: 'l&84' })).items.map((m) => m.meterId), ['J100003']);
  assert.equal((await store.list({ q: 'ge' })).total, 0); // make is not searched
  assert.equal((await store.list({ status: 'installed' })).total, 2);
  assert.equal((await store.list({ transformerCode: 'dt-007', phaseType: 'three' })).total, 1);
  const p2 = await store.list({ pageSize: 3, page: 2 });
  assert.equal(p2.items.length, 1);
  assert.equal(p2.total, 4);
  assert.equal((await store.list({ q: 'nomatch' })).items.length, 0);
});

test('get: unknown meter returns null', async () => {
  assert.equal(await new MeterStore(fakeClient()).get('J999999'), null);
});