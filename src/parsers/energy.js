const TS = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/;

// Portal format is DD/MM/YYYY HH:mm with no timezone. We return a naive local
// ISO string and do NOT invent an offset.
export function parsePortalTimestamp(raw) {
  const m = TS.exec(String(raw ?? '').trim());
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min] = m.map(Number);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd, hh, min));
  if (d.getUTCDate() !== dd || d.getUTCMonth() !== mm - 1 || d.getUTCHours() !== hh || d.getUTCMinutes() !== min) {
    return null; // rejects rollovers like 31/02
  }
  const p = (n) => String(n).padStart(2, '0');
  return `${yyyy}-${p(mm)}-${p(dd)}T${p(hh)}:${p(min)}:00`;
}

const num = (v) => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function normalizeEnergyRow(row) {
  return {
    timestamp: parsePortalTimestamp(row.timestamp),
    timestampRaw: row.timestamp ?? null, // preserved source value
    kwh: num(row.kwh),
    kvah: num(row.kvah),
    voltageR: num(row.voltR),
  };
}