import { z } from 'zod';
import { UpstreamError } from '../utils/errors.js';

export const HIERARCHY_LEVELS = ['zone', 'circle', 'division', 'subdivision', 'substation', 'feeder', 'dt'];

const str = z.string().nullish().transform((v) => v ?? null);
const node = z.object({ name: str, code: str }).nullish();

const upstream = z.object({
  data: z.array(
    z.object({
      meterId: z.string().min(1),
      serialNo: str,
      make: str,
      phaseType: str,
      installStatus: str,
      installType: str,
      build: str,
      dtCode: str,
      hierarchy: z.object(Object.fromEntries(HIERARCHY_LEVELS.map((l) => [l, node]))).partial().nullish(),
      geo: z.object({ lat: z.number().nullish(), lng: z.number().nullish() }).nullish(),
    }),
  ),
  total: z.number().int().nonnegative().optional(),
});

// The portal uses "" for missing values. We turn them into null and record an issue
// instead of silently dropping or inventing data.
const blank = (v) => (v == null || String(v).trim() === '' ? null : v);
const validCoord = (v, limit) => (typeof v === 'number' && Math.abs(v) <= limit ? v : null);

function normalizeMeter(r) {
  const issues = [];
  const hierarchy = HIERARCHY_LEVELS.map((level) => {
    const code = blank(r.hierarchy?.[level]?.code);
    const name = blank(r.hierarchy?.[level]?.name);
    if (code === null) issues.push(`hierarchy.${level}.code missing`);
    if (name === null) issues.push(`hierarchy.${level}.name missing`);
    return { level, code, name };
  });
  const latitude = validCoord(r.geo?.lat, 90);
  const longitude = validCoord(r.geo?.lng, 180);
  if (latitude === null || longitude === null) issues.push('location missing or out of range');

  return {
    meterId: r.meterId,
    serialNumber: blank(r.serialNo),
    make: blank(r.make),
    phaseType: blank(r.phaseType),
    status: blank(r.installStatus),
    installType: blank(r.installType),
    build: blank(r.build),
    transformerCode: blank(r.dtCode),
    hierarchy,
    location: { latitude, longitude },
    dataQuality: { issues },
  };
}

export function parseExport(body) {
  const r = upstream.safeParse(body);
  if (!r.success) throw new UpstreamError('Unexpected response from portal export');
  const { data, total } = r.data;
  // Never serve a partial dataset silently (we don't know whether export is paginated).
  if (total !== undefined && total !== data.length) {
    throw new UpstreamError(`Portal export is incomplete (${data.length} of ${total} meters)`);
  }
  return data.map(normalizeMeter);
}