'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const C = require('./collection.js');
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }
const close = (a, b) => assert.ok(Math.abs(a - b) <= 1e-12, `${a} differs from ${b}`);
// movement and adjacency vary; orientation, roughness and states split take the given values.
const candidate = (id, movement, adjacency, mode = 'generated', index = Number(id) - 1, extra = {}) => ({
  id, index, mode, parameters: {mode, shape: 'flat-side', noise: 0},
  metrics: {distance: extra.distance ?? 5, adjacency, angle: extra.angle ?? 0, roughness: extra.roughness ?? 1},
  stateMetrics: {statesSplit: extra.statesSplit ?? []},
  cells: [{id: '0101', x: 100, y: 200, q: 0, r: 0}],
  grid: {origin: [100, 200], step: 20, shape: 'flat-side', basis: [[20, 0], [10, Math.sqrt(3) * 10]]},
  step: 20, radius: 20 / Math.sqrt(3), diagnostics: {originalDisplacementMean: movement}
});
const zero = {originalMovement: 0, adjacency: 0, angle: 0, roughness: 0, statesSplit: 0};
const movementWeights = {...zero, originalMovement: 1};
const adjacencyWeights = {...zero, adjacency: 1};

test('the score has five terms and Distance is not one of them', () => {
  assert.deepEqual(C.terms.map(term => term.key), ['originalMovement', 'adjacency', 'angle', 'roughness', 'statesSplit']);
  const near = candidate(1, 2, 0.1, 'generated', 0, {distance: 1}), far = candidate(2, 2, 0.1, 'generated', 1, {distance: 99});
  const pool = C.scale([near, far, candidate(3, 3, 0.2)]);
  assert.equal(C.score(near, {}, pool), C.score(far, {}, pool));
  assert.deepEqual(C.termValues(candidate(1, 2, 0.1, 'generated', 0, {statesSplit: ['MI', 'NY']})),
    {originalMovement: 2, adjacency: 0.1, angle: 0, roughness: 1, statesSplit: 2});
});

test('each term is rescaled to 0-1 over the pool and the score is the weighted mean', () => {
  const inputs = [candidate(1, 2, 0.1, 'generated', 0, {statesSplit: ['A']}), candidate(2, 4, 0.5, 'generated', 1, {statesSplit: []}),
    candidate(3, 3, 0.2, 'generated', 2, {statesSplit: ['A', 'B', 'C', 'D']})];
  const pool = C.scale(inputs);
  assert.equal(pool.count, 3);
  assert.deepEqual([pool.min.originalMovement, pool.max.originalMovement], [2, 4]);
  assert.deepEqual(pool.constant, ['angle', 'roughness']);
  assert.deepEqual(C.normalized(inputs[2], pool), {originalMovement: 0.5, adjacency: 0.25, angle: null, roughness: null, statesSplit: 1});
  // Constant terms drop out of both the sum and the weights.
  close(C.score(inputs[2], {}, pool), (0.5 + 0.25 + 1) / 3);
  close(C.score(inputs[2], {originalMovement: 2, adjacency: 0, statesSplit: 1, roughness: 50}, pool), (2 * 0.5 + 1) / 3);
  // Raw units no longer decide the result: rescaling a metric's unit leaves the ranking alone.
  const scaled = inputs.map(x => ({...x, diagnostics: {originalDisplacementMean: x.diagnostics.originalDisplacementMean * 1000}}));
  assert.deepEqual(C.rank(scaled).map(x => x.id), C.rank(inputs).map(x => x.id));
  for (const x of inputs) { const s = C.score(x, {}, pool); assert.ok(s >= 0 && s <= 1); }
});

test('a pool that cannot be rescaled scores 0 and scoring needs a pool', () => {
  const only = candidate(1, 2, 0.1);
  assert.equal(C.score(only, {}, C.scale([only])), 0);
  assert.equal(C.score(only, zero, C.scale([only, candidate(2, 3, 0.2)])), 0);
  assert.throws(() => C.score(only, {}), /pool/);
  assert.deepEqual(C.scale([]).constant, C.terms.map(term => term.key));
});

test('a reference outside the pool is scored on the pool scale without changing it', () => {
  const inputs = [candidate(1, 2, 0.1), candidate(2, 4, 0.5)];
  const pool = C.scale(inputs), reference = candidate(9, 8, 0.05, 'nyu-original');
  assert.deepEqual(C.normalized(reference, pool), {originalMovement: 3, adjacency: -0.125, angle: null, roughness: null, statesSplit: null});
  close(C.score(reference, {}, pool), (3 - 0.125) / 2);
  assert.deepEqual(C.scale(inputs), pool);
});

test('ranking uses current weights without mutating candidates', () => {
  const inputs = [candidate(1, 2, 0.1), candidate(2, 1, 0.5), candidate(3, 3, 0.2)];
  const before = JSON.stringify(inputs);
  assert.deepEqual(C.rank(inputs, movementWeights).map(x => x.id), [2, 1, 3]);
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
  assert.deepEqual(C.selectedInRankOrder(inputs, movementWeights, new Set(['3', '2'])).map(x => x.id), [2, 3]);
  assert.deepEqual(C.selectedInRankOrder(inputs, adjacencyWeights, [3, 2]).map(x => x.id), [3, 2]);
  assert.deepEqual(C.selectedInRankOrder(inputs, movementWeights, []).map(x => x.id), []);
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
  source.metrics.adjacency = 999;
  source.stateMetrics.statesSplit.push('MI');
  source.parameters.noise = 1;
  source = candidate(2, 4, 0.2);
  const saved = collection.list()[0].result;
  assert.equal(saved.id, 1);
  assert.equal(saved.cells[0].x, 100);
  assert.equal(saved.metrics.adjacency, 0.1);
  assert.deepEqual(saved.stateMetrics.statesSplit, []);
  assert.equal(saved.parameters.noise, 0);
});

test('saved collection reranks and removes entries without changing snapshots', () => {
  const collection = C.create();
  collection.add(candidate(1, 2, 0.1), 1);
  collection.add(candidate(2, 1, 0.5), 1);
  assert.deepEqual(collection.list(movementWeights).map(x => x.originalId), [2, 1]);
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

test('saved layouts from different batches are rescaled against each other', () => {
  const collection = C.create();
  collection.add(candidate(1, 3, 0.1), 'batch1');
  collection.add(candidate(1, 1, 0.5, 'nyu-fixed'), 'batch2');
  const entries = collection.list(movementWeights), before = JSON.stringify(entries);
  const output = C.exportCandidates(entries, adjacencyWeights);
  assert.deepEqual(output.map(x => x.id), ['batch1-generated-1', 'batch2-nyu-fixed-1']);
  assert.deepEqual(output.map(x => x.rank), [1, 2]);
  assert.deepEqual(output.map(x => x.score), [0, 1]);
  assert.equal(output[0].sourceCandidateId, 1);
  assert.equal(output[0].sourceBatchId, 'batch1');
  output[0].cells[0].x = -999;
  assert.equal(JSON.stringify(entries), before);
  // A third saved layout changes the pool, and so the scores of the first two.
  collection.add(candidate(2, 5, 0.9), 'batch3');
  assert.deepEqual(C.exportCandidates(collection.list(adjacencyWeights), adjacencyWeights).map(x => x.score), [0, 0.5, 1]);
});

test('invalid scores and identifiers fail clearly', () => {
  const bad = candidate(1, 2, 0.1), pool = C.scale([candidate(1, 2, 0.1), candidate(2, 3, 0.2)]);
  assert.throws(() => C.score(bad, {adjacency: -1}, pool), /nonnegative/);
  bad.metrics.angle = NaN;
  assert.throws(() => C.rank([bad]), /finite/);
  const noStates = candidate(1, 2, 0.1);
  delete noStates.stateMetrics;
  assert.throws(() => C.rank([noStates]), /finite/);
  assert.throws(() => C.create().add(noStates, 1), /finite/);
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
  assert.equal(api.exportCandidates(collection.list(), movementWeights)[0].id, '1-generated-1');
});

console.log(`${passed} collection test groups passed.`);
