
import { Router } from 'express';
import { z } from 'zod';
import { normalizeEnergyRow } from '../parsers/energy.js';
import { energyPath } from '../services/portalPaths.js';
import { AppError, UpstreamError } from '../utils/errors.js';

const meterIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

export function createConsumptionRouter({ portalClient, meterStore }) {
  const router = Router();

  router.get('/:meterId/consumption', async (req, res) => {
    const parsedId = meterIdSchema.safeParse(req.params.meterId);

    if (!parsedId.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid meter ID');
    }

    // Verify the meter against the export snapshot before requesting readings.
    const meter = await meterStore.get(parsedId.data);

    if (!meter) {
      throw new AppError(404, 'METER_NOT_FOUND', 'Meter not found');
    }

    const { status, data } = await portalClient.getJson(
      energyPath(parsedId.data),
    );

    if (status === 404) {
      throw new UpstreamError(
        'Portal has no consumption data for this meter',
        { code: 'UPSTREAM_RESOURCE_NOT_FOUND' },
      );
    }

    if (!Array.isArray(data?.data)) {
      throw new UpstreamError('Portal returned an invalid consumption response');
    }

    const readings = data.data.map(normalizeEnergyRow);

    res.json({
      meterId: parsedId.data,
      count: readings.length,
      readings,
    });
  });

  return router;
}
