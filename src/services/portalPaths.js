// Always encode: the portal splits an unencoded "&" (e.g. serial "L&84997").
export const searchPath = (q = '', page = 1) =>
  `/portal/meters/search?q=${encodeURIComponent(q)}&page=${page}`;
const id = (meterId) => encodeURIComponent(meterId);
export const energyPath = (meterId) => `/portal/meters/${id(meterId)}/energy`;
export const geoPath = (meterId) => `/portal/meters/${id(meterId)}/geo`;
export const dtsPath = (page = 1) => `/portal/dts?page=${page}`;
export const exportPath = (page = 1) => `/portal/export?page=${page}`;