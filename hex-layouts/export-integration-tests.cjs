/* Check selected and saved-group exports against the morph viewer importer. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const Jobs = require('./jobs.js');
const Collection = require('./collection.js');
const {values} = parseArgs({options: {'morph-dir': {type: 'string'}}});
const parentDirectory = path.resolve(__dirname, '..');
if (values['morph-dir'] === '') throw new Error('--morph-dir must name the morph comparison project directory.');
const morphDirectory = values['morph-dir'] !== undefined
  ? path.resolve(values['morph-dir'])
  : parentDirectory;
const importerPath = path.join(morphDirectory, 'layout-import.js');
if (!fs.existsSync(importerPath)) throw new Error(`Importer not found: ${importerPath}. Set --morph-dir to the morph comparison project.`);
const Importer = require(importerPath);
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const ids = data.regions.map(region => region.id);
const weights = {distance: 1, adjacency: 1, angle: 1, roughness: 1};
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }
function payload(candidates, mode = 'mixed') {
  return {format: 'hex-layout-lab-v2', mode, source: data.metadata,
    exportedAt: '2026-10-21T00:00:00.000Z', weights, candidates};
}
function verifyCandidate(imported, original) {
  assert.equal(imported.cells.length, 436);
  assert.equal(imported.mode, original.mode);
  assert.equal(imported.shape, original.parameters.shape);
  assert.equal(imported.step, original.step);
  assert.equal(imported.radius, original.radius);
  assert.deepEqual(imported.cells.map(cell => cell.id).sort(), ids.slice().sort());
  const expected = new Map(original.cells.map(cell => [cell.id, cell]));
  for (const cell of imported.cells) {
    const target = expected.get(cell.id);
    for (const key of ['x', 'y', 'q', 'r']) assert.equal(cell[key], target[key]);
  }
}
const fixed = Jobs.runOne(data, {mode: 'nyu-fixed', noise: 0, transform: 1, seed: 42});
Object.assign(fixed, {id: 1, index: 0});
const generated = Jobs.runOne(data, {mode: 'generated', noise: 0, transform: 1,
  smooth: 20, shift: 'none', shape: 'flat-side', seed: 42});
Object.assign(generated, {id: 1, index: 0});
const flatBase = Jobs.runOne(data, {mode: 'generated', noise: 0, transform: 1,
  smooth: 20, shift: 'none', shape: 'flat-base', seed: 42});
Object.assign(flatBase, {id: 2, index: 1});
const before = JSON.stringify([fixed, generated, flatBase]);

test('Selected export preserves the active ranking rather than checkbox order', () => {
  const candidates = [generated, flatBase];
  const ordered = Collection.rank(candidates, weights);
  const selectedIds = new Set(ordered.map(candidate => candidate.id).reverse());
  const selected = Collection.selectedInRankOrder(candidates, weights, selectedIds);
  assert.deepEqual(selected.map(candidate => candidate.id), ordered.map(candidate => candidate.id));
  const imported = Importer.parse(payload(selected, 'generated'), ids);
  selected.forEach((candidate, index) => verifyCandidate(imported[index], candidate));
  const subset = Collection.selectedInRankOrder(candidates, weights, new Set([ordered[1].id]));
  assert.equal(subset.length, 1);
  assert.equal(subset[0].id, ordered[1].id);
  verifyCandidate(Importer.parse(payload(subset, 'generated'), ids)[0], ordered[1]);
});

test('Saved group mixes modes and batches without candidate identifier collisions', () => {
  const saved = Collection.create();
  saved.add(fixed, 1);
  saved.add(generated, 2);
  saved.add(generated, 3);
  saved.add(flatBase, 2);
  const exported = Collection.exportCandidates(saved.list(weights), weights);
  assert.equal(exported.length, 4);
  assert.equal(new Set(exported.map(candidate => candidate.id)).size, 4);
  assert.ok(exported.every(candidate => /^[A-Za-z0-9_-]{1,64}$/.test(candidate.id)));
  assert.deepEqual(exported.map(candidate => candidate.rank), [1, 2, 3, 4]);
  const imported = Importer.parse(payload(exported), ids);
  exported.forEach((candidate, index) => {
    const original = candidate.mode === 'nyu-fixed' ? fixed
      : candidate.parameters.shape === 'flat-base' ? flatBase : generated;
    verifyCandidate(imported[index], original);
    assert.equal(imported[index].id, candidate.id);
    assert.equal(String(candidate.sourceCandidateId), String(original.id));
    assert.ok(candidate.sourceBatchId);
  });
});

test('Removing and reranking saved layouts does not change their geometry', () => {
  const saved = Collection.create();
  saved.add(fixed, 1); saved.add(generated, 2); saved.add(flatBase, 2);
  const fixedEntry = saved.list(weights).find(entry => entry.result.mode === 'nyu-fixed');
  saved.remove(fixedEntry.key);
  const alternate = {distance: 0, adjacency: 10, angle: 0, roughness: 0};
  const exported = Collection.exportCandidates(saved.list(alternate), alternate);
  assert.equal(exported.length, 2);
  assert.ok(exported.every(candidate => candidate.mode === 'generated'));
  assert.ok(Collection.score(exported[0], alternate) <= Collection.score(exported[1], alternate));
  const imported = Importer.parse(payload(exported), ids);
  exported.forEach((candidate, index) => verifyCandidate(imported[index], candidate));
  assert.equal(JSON.stringify([fixed, generated, flatBase]), before);
});

console.log(`${passed} export integration tests passed; all candidates retained 436 exact district assignments.`);
