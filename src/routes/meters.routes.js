
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';

const querySchema = z.object({
  q: z.string().max(100).optional(),
  status: z.string().min(1).max(100).optional(),
  phaseType: z.string().min(1).max(100).optional(),
  make: z.string().min(1).max(100).optional(),
  installType: z.string().min(1).max(100).optional(),
  build: z.string().min(1).max(100).optional(),
  transformerCode: z.string().min(1).max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const meterIdSchema = z.string().regex(
  /^[A-Za-z0-9_-]{1,32}$/,
  'Invalid meter ID',
);

export function createMetersRouter({ meterStore }) {
  const router = Router();

  router.get('/', async (req, res) => {
    const parsed = querySchema.safeParse(req.query);

    if (!parsed.success) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Invalid meter query parameters',
      );
    }

    const result = await meterStore.list(parsed.data);
    res.json(result);
  });

  router.get('/:meterId', async (req, res) => {
    const parsedId = meterIdSchema.safeParse(req.params.meterId);

    if (!parsedId.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid meter ID');
    }

    const meter = await meterStore.get(parsedId.data);

    if (!meter) {
      throw new AppError(404, 'METER_NOT_FOUND', 'Meter not found');
    }

    res.json({ data: meter });
  });

  return router;
}
