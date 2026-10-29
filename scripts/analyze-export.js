// Usage: node scripts/analyze-export.js path/to/export.json
import { readFileSync } from 'node:fs';

const { data } = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const levels = ['zone', 'circle', 'division', 'subdivision', 'substation', 'feeder', 'dt'];
const tally = (rows, f) => rows.reduce((m, r) => ((m[f(r)] = (m[f(r)] ?? 0) + 1), m), {});

console.log('rows', data.length, '| unique meterIds', new Set(data.map((m) => m.meterId)).size, '| unique serials', new Set(data.map((m) => m.serialNo)).size);
for (const k of ['installStatus', 'installType', 'build', 'phaseType', 'make']) console.log(k, tally(data, (m) => m[k]));

const blanks = [];
for (const m of data) for (const l of levels) for (const f of ['name', 'code']) if (!m.hierarchy?.[l]?.[f]) blanks.push(`${m.meterId} ${l}.${f}`);
console.log('blank hierarchy fields:', blanks.length, blanks.slice(0, 40));

levels.forEach((l, i) => {
  const names = {};
  const parents = {};
  for (const m of data) {
    const n = m.hierarchy?.[l];
    if (!n?.code) continue;
    if (n.name) (names[n.code] ??= new Set()).add(n.name);
    const parent = i > 0 ? m.hierarchy[levels[i - 1]]?.code : null;
    if (parent) (parents[n.code] ??= new Set()).add(parent);
  }
  const multiName = Object.entries(names).filter(([, s]) => s.size > 1).map(([c, s]) => [c, [...s]]);
  const multiParent = Object.entries(parents).filter(([, s]) => s.size > 1).map(([c, s]) => [c, [...s]]);
  console.log(`${l}: ${Object.keys(names).length} codes | >1 name:`, JSON.stringify(multiName), `| >1 parent: ${multiParent.length}`, JSON.stringify(multiParent.slice(0, 3)));
});

console.log('dtCode != hierarchy.dt.code:', data.filter((m) => m.dtCode !== m.hierarchy?.dt?.code).map((m) => m.meterId));
console.log('geo missing/out of range:', data.filter((m) => typeof m.geo?.lat !== 'number' || typeof m.geo?.lng !== 'number').map((m) => m.meterId));