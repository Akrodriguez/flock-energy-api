import { z } from 'zod';
import { UpstreamError } from '../utils/errors.js';

// Only meterId is required; other fields tolerate null/missing so one messy row
// doesn't fail a whole page (we haven't seen nulls yet, so this is defensive).
const str = z.string().nullish().transform((v) => v ?? null);

const upstream = z.object({
  data: z.array(
    z.object({
      meterId: z.string().min(1),
      serialNo: str,
      make: str,
      phaseType: str,
      installStatus: str,
      dtCode: str,
    }),
  ),
  total: z.number().int().nonnegative(),
  page: z.number().int(),
  pageSize: z.number().int().positive(),
});

export function parseMeterSearch(body) {
  const r = upstream.safeParse(body);
  if (!r.success) throw new UpstreamError('Unexpected response from portal meter search');
  const { data, total, page, pageSize } = r.data;
  return {
    items: data.map((m) => ({
      meterId: m.meterId,
      serialNumber: m.serialNo,
      make: m.make,
      phaseType: m.phaseType,
      status: m.installStatus,
      transformerCode: m.dtCode,
    })),
    total,
    page,
    pageSize,
  };
}