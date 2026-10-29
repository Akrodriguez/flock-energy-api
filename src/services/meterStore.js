import { UpstreamError } from '../utils/errors.js';
import { parseExport } from '../parsers/export.js';
import { exportPath } from './portalPaths.js';

const eq = (a, b) => a !== null && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * In-memory snapshot of the portal export with a TTL.
 * The TTL is an assumption: how fresh the portal's meter records are is unverified.
 */
export class MeterStore {
  #client;
  #ttlMs;
  #now;
  #snapshot = null;
  #inFlight = null;

  constructor(client, { ttlMs = 600_000, now = Date.now } = {}) {
    this.#client = client;
    this.#ttlMs = ttlMs;
    this.#now = now;
  }

  async #load() {
    if (this.#snapshot && this.#now() - this.#snapshot.fetchedAtMs < this.#ttlMs) return this.#snapshot;
    this.#inFlight ??= this.#refresh().finally(() => {
      this.#inFlight = null;
    });
    return this.#inFlight;
  }

  async #refresh() {
    const { status, data } = await this.#client.getJson(exportPath(1));
    if (status !== 200) throw new UpstreamError(`Portal export unavailable (HTTP ${status})`);
    const meters = parseExport(data);
    this.#snapshot = {
      meters,
      byId: new Map(meters.map((m) => [m.meterId, m])),
      fetchedAtMs: this.#now(),
    };
    return this.#snapshot;
  }

  /** Filters: q (substring of meterId/serial, case-insensitive, like the portal's search), exact-match fields, paging. */
  async list({ q, status, phaseType, make, installType, build, transformerCode, page = 1, pageSize = 20 } = {}) {
    const snap = await this.#load();
    const needle = q?.toLowerCase();
    const matches = snap.meters.filter(
      (m) =>
        (!needle || m.meterId.toLowerCase().includes(needle) || (m.serialNumber ?? '').toLowerCase().includes(needle)) &&
        (!status || eq(m.status, status)) &&
        (!phaseType || eq(m.phaseType, phaseType)) &&
        (!make || eq(m.make, make)) &&
        (!installType || eq(m.installType, installType)) &&
        (!build || eq(m.build, build)) &&
        (!transformerCode || eq(m.transformerCode, transformerCode)),
    );
    const start = (page - 1) * pageSize;
    return {
      items: matches.slice(start, start + pageSize),
      total: matches.length,
      page,
      pageSize,
      fetchedAt: new Date(snap.fetchedAtMs).toISOString(),
    };
  }

  async getAll() {
  const snap = await this.#load();
  return {
    meters: snap.meters,
    fetchedAt: new Date(snap.fetchedAtMs).toISOString(),
  };
}

  async get(meterId) {
    return (await this.#load()).byId.get(meterId) ?? null;
  }
}