
import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../utils/errors.js';
import { HIERARCHY_LEVELS } from '../parsers/export.js';

const codeSchema = z.string().regex(
  /^[A-Za-z0-9_-]{1,100}$/,
  'Invalid transformer code',
);

function hierarchyPath(meter, throughLevel) {
  const end = HIERARCHY_LEVELS.indexOf(throughLevel);
  return meter.hierarchy.slice(0, end + 1).map((node) => ({
    level: node.level,
    code: node.code,
    name: node.name,
  }));
}

function buildHierarchy(meters) {
  const root = {
    level: 'root',
    code: null,
    name: 'Network',
    children: new Map(),
  };

  for (const meter of meters) {
    let current = root;

    for (const node of meter.hierarchy) {
      // Missing codes must not cause unrelated nodes to be merged.
      const key = JSON.stringify([node.code, node.name]);

      if (!current.children.has(key)) {
        current.children.set(key, {
          level: node.level,
          code: node.code,
          name: node.name,
          children: new Map(),
        });
      }

      current = current.children.get(key);
      current.meterCount = (current.meterCount ?? 0) + 1;
    }
  }

  function serialize(node) {
    return {
      level: node.level,
      code: node.code,
      name: node.name,
      ...(node.meterCount === undefined ? {} : { meterCount: node.meterCount }),
      children: [...(node.children?.values() ?? [])].map(serialize),
    };
  }

  return serialize(root);
}

function buildTransformers(meters) {
  const groups = new Map();

  for (const meter of meters) {
    const dt = meter.hierarchy.find((node) => node.level === 'dt');

    if (!dt?.code) continue;

    const ancestors = hierarchyPath(meter, 'feeder');
    const key = JSON.stringify([
      ancestors.map((node) => [node.code, node.name]),
      dt.code,
    ]);

    if (!groups.has(key)) {
      groups.set(key, {
        code: dt.code,
        names: [],
        hierarchy: ancestors,
        meterCount: 0,
      });
    }

    const group = groups.get(key);

    if (dt.name && !group.names.includes(dt.name)) {
      group.names.push(dt.name);
    }

    group.meterCount += 1;
  }

  return [...groups.values()].sort((a, b) =>
    a.code.localeCompare(b.code),
  );
}

export function createNetworkRouter({ meterStore }) {
  const router = Router();

  router.get('/hierarchy', async (_req, res) => {
    const { meters, fetchedAt } = await meterStore.getAll();

    res.json({
      data: buildHierarchy(meters).children,
      fetchedAt,
    });
  });

  router.get('/transformers', async (req, res) => {
    const querySchema = z.object({
      q: z.string().max(100).optional(),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
    });

    const parsed = querySchema.safeParse(req.query);

    if (!parsed.success) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Invalid transformer query parameters',
      );
    }

    const { meters, fetchedAt } = await meterStore.getAll();
    let items = buildTransformers(meters);

    if (parsed.data.q) {
      const q = parsed.data.q.toLowerCase();
      items = items.filter((item) =>
        item.code.toLowerCase().includes(q) ||
        item.names.some((name) => name.toLowerCase().includes(q)),
      );
    }

    const total = items.length;
    const start = (parsed.data.page - 1) * parsed.data.pageSize;

    res.json({
      items: items.slice(start, start + parsed.data.pageSize),
      total,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      fetchedAt,
    });
  });

  router.get('/transformers/:code', async (req, res) => {
    const parsed = codeSchema.safeParse(req.params.code);

    if (!parsed.success) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid transformer code');
    }

    const { meters, fetchedAt } = await meterStore.getAll();
    const matches = buildTransformers(meters).filter(
      (item) => item.code.toLowerCase() === parsed.data.toLowerCase(),
    );

    if (matches.length === 0) {
      throw new AppError(404, 'TRANSFORMER_NOT_FOUND', 'Transformer not found');
    }

    // Don't silently choose a result if a code maps to multiple paths.
    if (matches.length > 1) {
      throw new AppError(
        409,
        'AMBIGUOUS_TRANSFORMER_CODE',
        'Transformer code matches multiple network paths',
      );
    }

    res.json({ data: matches[0], fetchedAt });
  });

  return router;
}
