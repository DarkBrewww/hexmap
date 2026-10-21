'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('./collection.js');
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }
const candidate = (id, distance, adjacency, mode = 'generated', index = Number(id) - 1) => ({
  id, index, mode, parameters: {mode, shape: 'flat-side', noise: 0},
  metrics: {distance, adjacency, angle: 0, roughness: 1},
  cells: [{id: '0101', x: 100, y: 200, q: 0, r: 0}],
  grid: {origin: [100, 200], step: 20, shape: 'flat-side', basis: [[20, 0], [10, Math.sqrt(3) * 10]]},
  step: 20, radius: 20 / Math.sqrt(3), diagnostics: {originalDisplacementMean: 2}
});
const distanceWeights = {distance: 1, adjacency: 0, angle: 0, roughness: 0};
const adjacencyWeights = {distance: 0, adjacency: 1, angle: 0, roughness: 0};

test('ranking uses current weights without mutating candidates', () => {
  const inputs = [candidate(1, 2, 0.1), candidate(2, 1, 0.5), candidate(3, 3, 0.2)];
  const before = JSON.stringify(inputs);
  assert.deepEqual(C.rank(inputs, distanceWeights).map(x => x.id), [2, 1, 3]);
  assert.deepEqual(C.rank(inputs, adjacencyWeights).map(x => x.id), [1, 3, 2]);
  assert.equal(JSON.stringify(inputs), before);
});

test('rank ties use original index, then candidate ID, then stable input order', () => {
  const inputs = [candidate(10, 1, 0), candidate(2, 1, 0), candidate(1, 1, 0)];
  inputs.forEach(x => delete x.index);
  assert.deepEqual(C.rank(inputs).map(x => x.id), [1, 2, 10]);
  inputs[0].index = 0;
  assert.deepEqual(C.rank(inputs).map(x => x.id), [10, 1, 2]);
  const first = candidate(1, 1, 0), second = candidate(1, 1, 0);
  assert.strictEqual(C.rank([first, second])[0], first);
});

test('partial exports follow ranking, not checkbox selection order', () => {
  const inputs = [candidate(1, 2, 0.1), candidate(2, 1, 0.5), candidate(3, 3, 0.2)];
  assert.deepEqual(C.selectedInRankOrder(inputs, distanceWeights, new Set(['3', '2'])).map(x => x.id), [2, 3]);
  assert.deepEqual(C.selectedInRankOrder(inputs, adjacencyWeights, [3, 2]).map(x => x.id), [3, 2]);
  assert.deepEqual(C.selectedInRankOrder(inputs, distanceWeights, []).map(x => x.id), []);
});

test('saving the same candidate twice does not duplicate it', () => {
  const collection = C.create(), result = candidate(1, 2, 0.1);
  const saved = collection.add(result, 1);
  assert.strictEqual(collection.add(result, 1), saved);
  assert.equal(collection.size, 1);
  assert.equal(collection.has(result, 1), true);
});

test('equal candidate IDs across modes and batches stay independent', () => {
  const collection = C.create();
  collection.add(candidate(1, 2, 0.1), 1);
  collection.add(candidate(1, 2, 0.1, 'nyu-fixed'), 1);
  collection.add(candidate(1, 2, 0.1), 2);
  assert.equal(collection.size, 3);
  assert.deepEqual(collection.list().map(x => x.key), ['1-generated-1', '1-nyu-fixed-1', '2-generated-1']);
});

test('saved layouts survive source replacement and nested mutations', () => {
  const collection = C.create();
  let source = candidate(1, 2, 0.1);
  collection.add(source, 1);
  source.cells[0].x = 999;
  source.metrics.distance = 999;
  source.parameters.noise = 1;
  source = candidate(2, 4, 0.2);
  const saved = collection.list()[0].result;
  assert.equal(saved.id, 1);
  assert.equal(saved.cells[0].x, 100);
  assert.equal(saved.metrics.distance, 2);
  assert.equal(saved.parameters.noise, 0);
});

test('saved collection reranks and removes entries without changing snapshots', () => {
  const collection = C.create();
  collection.add(candidate(1, 2, 0.1), 1);
  collection.add(candidate(2, 1, 0.5), 1);
  assert.deepEqual(collection.list(distanceWeights).map(x => x.originalId), [2, 1]);
  assert.deepEqual(collection.list(adjacencyWeights).map(x => x.originalId), [1, 2]);
  assert.equal(collection.remove('1-generated-1'), true);
  assert.equal(collection.remove('1-generated-1'), false);
  assert.equal(collection.size, 1);
  assert.equal(collection.get('1-generated-2').originalId, 2);
  assert.equal(collection.get('missing'), undefined);
});

test('saved collection respects the import-compatible candidate limit', () => {
  const collection = C.create();
  for (let id = 1; id <= 512; id++) collection.add(candidate(id, 1, 0), 1);
  assert.equal(collection.size, 512);
  assert.doesNotThrow(() => collection.add(candidate(1, 1, 0), 1));
  assert.throws(() => collection.add(candidate(513, 1, 0), 1), /limited to 512/);
  collection.remove('1-generated-1');
  assert.doesNotThrow(() => collection.add(candidate(513, 1, 0), 1));
});

test('saved exports use unique IDs, current ranks, and source provenance', () => {
  const collection = C.create();
  collection.add(candidate(1, 3, 0.1), 'batch1');
  collection.add(candidate(1, 1, 0.5, 'nyu-fixed'), 'batch2');
  const entries = collection.list(distanceWeights), before = JSON.stringify(entries);
  const output = C.exportCandidates(entries, adjacencyWeights);
  assert.deepEqual(output.map(x => x.id), ['batch1-generated-1', 'batch2-nyu-fixed-1']);
  assert.deepEqual(output.map(x => x.rank), [1, 2]);
  assert.deepEqual(output.map(x => x.score), [0.1, 0.5]);
  assert.equal(output[0].sourceCandidateId, 1);
  assert.equal(output[0].sourceBatchId, 'batch1');
  output[0].cells[0].x = -999;
  assert.equal(JSON.stringify(entries), before);
});

test('invalid scores and identifiers fail clearly', () => {
  const bad = candidate(1, 2, 0.1);
  assert.throws(() => C.score(bad, {distance: -1}), /nonnegative/);
  bad.metrics.angle = NaN;
  assert.throws(() => C.rank([bad]), /finite/);
  assert.throws(() => C.create().add(candidate(1, 2, 0.1), 'invalid/batch'), /Batch ID/);
  assert.throws(() => C.create().add(candidate(1, 2, 0.1, 'nyu-original'), 1), /Only candidate/);
});

test('browser export and JSON-clone fallback work without CommonJS', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'collection.js'), 'utf8'), context);
  const api = context.HexLayoutCollection;
  const collection = api.create();
  const result = candidate(1, 2, 0.1);
  collection.add(result, 1);
  result.cells[0].x = -100;
  assert.equal(collection.list()[0].result.cells[0].x, 100);
  assert.equal(api.exportCandidates(collection.list(), distanceWeights)[0].id, '1-generated-1');
});

console.log(`${passed} collection test groups passed.`);
