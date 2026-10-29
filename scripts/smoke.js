// Run: node --env-file=.env scripts/smoke.js
import { loadConfig } from '../src/config/env.js';
import { PortalClient } from '../src/services/portalClient.js';
import { searchPath } from '../src/services/portalPaths.js';

const client = new PortalClient(loadConfig());
const { status, data } = await client.getJson(searchPath('', 1));
console.log('status', status, '| total', data.total, '| rows on page', data.data?.length);