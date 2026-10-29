import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePortalTimestamp, normalizeEnergyRow } from '../src/parsers/energy.js';
import { parseMeterSearch } from '../src/parsers/meters.js';
import { searchPath } from '../src/services/portalPaths.js';
import { UpstreamError } from '../src/utils/errors.js';

test('timestamp parsing is day-first and rejects invalid dates', () => {
  assert.equal(parsePortalTimestamp('23/06/2026 23:30'), '2026-06-23T23:30:00');
  assert.equal(parsePortalTimestamp('31/02/2026 10:00'), null);
  assert.equal(parsePortalTimestamp('garbage'), null);
});

test('energy row: strings become numbers, raw timestamp preserved', () => {
  const row = normalizeEnergyRow({ timestamp: '24/06/2026 00:00', kwh: '42594.47', kvah: '46002.02', voltR: '230' });
  assert.deepEqual(row, {
    timestamp: '2026-06-24T00:00:00',
    timestampRaw: '24/06/2026 00:00',
    kwh: 42594.47,
    kvah: 46002.02,
    voltageR: 230,
  });
  assert.equal(normalizeEnergyRow({ timestamp: 'x', kwh: '', kvah: 'abc', voltR: null }).kwh, null);
});

test('search path encodes ampersands in the query', () => {
  assert.equal(searchPath('L&84997', 1), '/portal/meters/search?q=L%2684997&page=1');
});

test('meter search normalizes fields and tolerates nulls', () => {
  const out = parseMeterSearch({
    data: [
      { meterId: 'J100003', serialNo: 'L&84997', make: 'Genus', phaseType: 'single', installStatus: 'Installed', dtCode: 'DT-004' },
      { meterId: 'J100999', serialNo: null },
    ],
    total: 403, page: 1, pageSize: 20,
  });
  assert.equal(out.items[0].transformerCode, 'DT-004');
  assert.equal(out.items[1].make, null);
  assert.equal(out.total, 403);
});

test('malformed meter search response becomes a 502', () => {
  assert.throws(() => parseMeterSearch({ nope: 1 }), (e) => e instanceof UpstreamError && e.status === 502);
});