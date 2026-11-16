/* The layouts for the staged-timing runs, taken from the fixed-grid overlap experiment.
 *
 *   node experiments/staged-timing/make_layouts.cjs [ID ...]
 *
 * Copies the named candidates from experiments/fixed-grid-overlap/candidates.json and
 * candidates_extended.json into layouts.json (hex-layout-lab-v2), and reads the file back with the
 * morph viewer's importer. The NYU layout needs no entry: the morph page has it built in.
 * Defaults: the lowest Linear overlap peak of the 126 candidates, two more low ones, a middle one
 * and the highest.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(ROOT, 'experiments', 'fixed-grid-overlap');
const Importer = require(path.join(ROOT, 'layout-import.js'));
const wanted = process.argv.slice(2).length ? process.argv.slice(2)
  : ['fixed-n0p05-t1-s2', 'fixed-n0-t1', 'fixed-n0p2-t0p6', 'fixed-n0p4-t0-s4'];

const files = ['candidates.json', 'candidates_extended.json'].map(name => JSON.parse(fs.readFileSync(path.join(SOURCE, name), 'utf8')));
const byId = new Map();
for (const file of files) for (const candidate of file.candidates) if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
const candidates = wanted.map((id, i) => {
  if (!byId.has(id)) throw new Error(`No candidate named ${id} in the fixed-grid overlap experiment.`);
  return {...byId.get(id), rank: i + 1};
});
const {candidates: _, ...header} = files[0];
const payload = {...header, exportedAt: new Date().toISOString(), exportScope: 'selected', exportedCount: candidates.length,
  completed: candidates.length, total: candidates.length, candidates};
const ids = JSON.parse(fs.readFileSync(path.join(ROOT, 'hex-layouts', 'data.json'), 'utf8')).regions.map(region => String(region.id));
if (Importer.parse(payload, ids).length !== candidates.length) throw new Error('The importer did not accept every candidate.');
fs.writeFileSync(path.join(__dirname, 'layouts.json'), JSON.stringify(payload));
console.log(`wrote layouts.json with ${candidates.map(c => c.id).join(', ')}`);
