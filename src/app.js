
import express from 'express';
import { healthRouter } from './routes/health.routes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { PortalClient } from './services/portalClient.js';
import { MeterStore } from './services/meterStore.js';
import { createMetersRouter } from './routes/meters.routes.js';
import { createConsumptionRouter } from './routes/consumption.routes.js';
import { createNetworkRouter } from './routes/network.routes.js';

export function createApp({
  config,
  portalClient,
  meterStore,
} = {}) {
  const app = express();

  app.disable('x-powered-by');

  app.use('/health', healthRouter);

  if (config) {
    portalClient ??= new PortalClient(config);
    meterStore ??= new MeterStore(portalClient, {
      ttlMs: config.EXPORT_TTL_MS,
    });

    app.use(
      '/api/v1/meters',
      createConsumptionRouter({ portalClient, meterStore }),
    );
  }

  if (meterStore) {
    app.use('/api/v1/meters', createMetersRouter({ meterStore }));
    app.use('/api/v1', createNetworkRouter({ meterStore }));
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
