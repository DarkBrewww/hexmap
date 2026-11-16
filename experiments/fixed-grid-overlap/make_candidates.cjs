/* Fixed NYU grid candidates for the overlap experiment, exported in the format the morph viewer imports.
 *
 *   node experiments/fixed-grid-overlap/make_candidates.cjs [--noise 0,0.05] [--transform 0,1]
 *        [--seeds 42] [--out FILE] [--check FILE]
 *
 * Every candidate keeps the 436 NYU cells, their size and their spacing; only the district-to-cell
 * assignment changes. Candidates are built with hex-layouts/jobs.js, the same code the Hex Map Layouts
 * page runs, and written as a hex-layout-lab-v2 file in the page's own export layout. Identical
 * assignments are kept once. --check FILE compares candidates that share an id with FILE (for example
 * evidence/friday_layouts.json) cell by cell.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');

const ROOT = path.resolve(__dirname, '..', '..');
const Engine = require(path.join(ROOT, 'hex-layouts', 'engine.js'));
const Jobs = require(path.join(ROOT, 'hex-layouts', 'jobs.js'));
const Collection = require(path.join(ROOT, 'hex-layouts', 'collection.js'));
const Importer = require(path.join(ROOT, 'layout-import.js'));

const {values} = parseArgs({options: {
  noise: {type: 'string', default: '0,0.05,0.1,0.2,0.4'},
  transform: {type: 'string', default: '0,0.2,0.4,0.6,0.8,1'},
  seeds: {type: 'string', default: '42'},
  out: {type: 'string', default: path.join(__dirname, 'candidates.json')},
  check: {type: 'string'}
}});
const list = text => text.split(',').map(s => Number(s.trim()));
const noises = list(values.noise), transforms = list(values.transform), seeds = list(values.seeds);
const WEIGHTS = {distance: 1, adjacency: 1, angle: 1, roughness: 1};

// Same naming as evidence/friday_layouts.json: fixed-n0p1-t1 is Noise 0.1, Transform 1.
const token = x => String(x).replace('.', 'p');
const idFor = p => `fixed-n${token(p.noise)}-t${token(p.transform)}` + (p.seed === 42 ? '' : `-s${p.seed}`);

const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'hex-layouts', 'data.json'), 'utf8'));
const ids = data.regions.map(region => String(region.id));

const results = [], manifest = [], bySignature = new Map();
for (const seed of seeds) for (const noise of noises) for (const transform of transforms) {
  // Without noise the seed has no effect, so seed variants are only run for noise > 0.
  if (noise === 0 && seed !== seeds[0]) continue;
  const parameters = {mode: 'nyu-fixed', noise, transform, seed};
  const result = Jobs.runOne(data, parameters);
  const id = idFor(result.parameters);
  const duplicateOf = bySignature.get(result.signature) || '';
  manifest.push({id, noise, transform, seed, duplicate_of: duplicateOf,
    changed_assignments: result.diagnostics.changedAssignments});
  if (duplicateOf) continue;
  bySignature.set(result.signature, id);
  results.push(Object.assign(result, {id, index: results.length}));
}

const baseline = Jobs.originalNyu(data);
const ranked = Collection.rank(results, WEIGHTS);
const candidates = ranked.map((result, i) => ({
  rank: i + 1, id: result.id, mode: result.mode, parameters: result.parameters, metrics: result.metrics,
  weightedCost: Collection.score(result, WEIGHTS), cells: result.cells, grid: result.grid, step: result.step,
  radius: result.radius, referenceStep: result.referenceStep, diagnostics: result.diagnostics,
  perRegion: result.perRegion
}));
const payload = {
  format: 'hex-layout-lab-v2', mode: 'nyu-fixed', algorithm: Engine.version,
  exportedAt: new Date().toISOString(), source: data.metadata, exportScope: 'all',
  exportedCount: candidates.length, completed: candidates.length, total: candidates.length,
  incomplete: false, weights: WEIGHTS, failures: [], nyuTarget: data.nyuTarget,
  originalNyuBaseline: {metrics: baseline.metrics, diagnostics: baseline.diagnostics,
    cells: baseline.cells, radius: baseline.radius},
  candidates
};

// Read the file back with the morph viewer's importer before saving it.
const imported = Importer.parse(payload, ids);
if (imported.length !== candidates.length) throw new Error('The importer did not accept every candidate.');

if (values.check) {
  const reference = JSON.parse(fs.readFileSync(values.check, 'utf8'));
  const mine = new Map(candidates.map(c => [c.id, c]));
  let compared = 0;
  for (const other of reference.candidates) {
    const own = mine.get(other.id);
    if (!own) continue;
    const at = new Map(other.cells.map(cell => [cell.id, cell]));
    const same = own.cells.every(cell => {
      const o = at.get(cell.id);
      return o && o.q === cell.q && o.r === cell.r && o.x === cell.x && o.y === cell.y;
    });
    console.log(`check ${other.id}: ${same ? 'identical cells' : 'DIFFERENT cells'}`);
    if (!same) process.exitCode = 1;
    compared++;
  }
  if (!compared) console.log('check: no shared candidate ids');
}

fs.writeFileSync(values.out, JSON.stringify(payload));
const manifestPath = values.out.replace(/\.json$/, '') + '_manifest.csv';
const header = 'id,noise,transform,seed,duplicate_of,changed_assignments';
fs.writeFileSync(manifestPath, [header, ...manifest.map(m =>
  [m.id, m.noise, m.transform, m.seed, m.duplicate_of, m.changed_assignments].join(','))].join('\n') + '\n');
const duplicates = manifest.filter(m => m.duplicate_of).length;
console.log(`${manifest.length} parameter settings, ${candidates.length} distinct assignments` +
  (duplicates ? `, ${duplicates} duplicates dropped` : '') + `\nwrote ${path.relative(ROOT, values.out)} and ${path.relative(ROOT, manifestPath)}`);
