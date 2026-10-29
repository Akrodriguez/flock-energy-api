
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  PORTAL_BASE_URL: z.url().default('https://urja-ops.flockenergy.tech'),
  PORTAL_USERNAME: z.string().min(1),
  PORTAL_PASSWORD: z.string().min(1),
  PORTAL_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  EXPORT_TTL_MS: z.coerce.number().int().positive().default(600000),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);

  if (!parsed.success) {
    const fields = parsed.error.issues
      .map((issue) => issue.path.join('.'))
      .join(', ');

    throw new Error(`Invalid configuration: ${fields}`);
  }

  return parsed.data;
}
