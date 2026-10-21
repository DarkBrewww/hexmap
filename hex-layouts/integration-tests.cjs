/* Full-map regression. node integration-tests.cjs [--full] [--report=path]
 * --full additionally checks the original demo-style 288 combinations.
 * A JSON report is written only when --report names an output file.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {parseArgs} = require('node:util');
const {values} = parseArgs({options: {full: {type: 'boolean', default: false}, report: {type: 'string'}}});
if (values.report === '') throw new Error('--report must name an output JSON file.');
const Engine = require('./engine.js');
const Jobs = require('./jobs.js');
const Collection = require('./collection.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const sourceFingerprint = crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
const metricKeys = ['distance', 'adjacency', 'angle', 'roughness'];
const expectedIds = [...data.regions.map(region => region.id)].sort();
const fullGroup = {id: 'all', regions: data.regions};
const mainIds = new Set(data.groups.find(group => group.id === 'mainland').regions.map(region => region.id));
const started = Date.now();
const report = {algorithm: Engine.version, sourceSha256: data.metadata.sourceSha256, testGroups: [], defaultSweep: null, fullSweep: null};
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
function test(name, run) {
  const start = Date.now();
  const detail = run();
  report.testGroups.push({name, passed: true, elapsedMs: Date.now() - start, ...(detail === undefined ? {} : {detail})});
  console.log(`PASS ${name}`);
}
function area(boundary) {
  return Math.abs(boundary.reduce((sum, point, i) => {
    const next = boundary[(i + 1) % boundary.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0)) / 2;
}
function verifyLayout(result, parameters) {
  assert.deepEqual(result.parameters, parameters);
  assert.equal(result.grid.shape, parameters.shape);
  assert.equal(result.cells.length, 436);
  assert.deepEqual(result.cells.map(cell => cell.id).sort(), expectedIds);
  assert.equal(new Set(result.cells.map(cell => `${cell.q},${cell.r}`)).size, 436);
  assert.equal(result.diagnostics.fullCoverage, 436);
  assert.equal(result.diagnostics.uniqueCells, 436);
  assert.equal(result.diagnostics.originalEdges, 1136);
  assert.equal(result.diagnostics.originalEdges, result.diagnostics.retainedEdges + result.diagnostics.lostEdges);
  assert.equal(result.diagnostics.tileEdges, result.diagnostics.retainedEdges + result.diagnostics.newEdges);
  assert.equal(result.transformedCenters.length, 436);
  assert.deepEqual(Engine.validate(fullGroup, result.cells, result.grid), {complete: true, unique: true, finite: true, regularLattice: true, nonOverlapping: true});
  for (const value of Object.values(result.metrics)) assert.ok(Number.isFinite(value) && value >= -1e-10);
  assert.ok(result.metrics.adjacency <= 1);
  assert.ok(result.metrics.angle <= Math.PI);
  for (const point of result.transformedCenters) assert.ok(point.every(Number.isFinite));
  const step = result.step;
  assert.ok(step > 0 && Number.isFinite(step));
  const expectedBasis = parameters.shape === 'flat-side'
    ? [[step, 0], [step / 2, Math.sqrt(3) * step / 2]]
    : [[Math.sqrt(3) * step / 2, step / 2], [0, step]];
  expectedBasis.forEach((basis, i) => basis.forEach((coordinate, j) => close(result.grid.basis[i][j], coordinate)));
  const initialStep = Math.sqrt(area(result.boundary) / 433);
  close(result.grid.origin[0], Math.min(...result.boundary.map(point => point[0])) - (parameters.shift.includes('x') ? initialStep / 2 : 0));
  close(result.grid.origin[1], Math.min(...result.boundary.map(point => point[1])) - (parameters.shift.includes('y') ? initialStep / 2 : 0));
  for (const cell of result.cells) {
    assert.ok(Number.isInteger(cell.q) && Number.isInteger(cell.r));
    close(cell.x, result.grid.origin[0] + cell.q * expectedBasis[0][0] + cell.r * expectedBasis[1][0]);
    close(cell.y, result.grid.origin[1] + cell.q * expectedBasis[0][1] + cell.r * expectedBasis[1][1]);
    if (mainIds.has(cell.id)) assert.equal(Engine.contains([cell.x, cell.y], result.boundary), true);
  }
  const byId = new Map(result.cells.map(cell => [cell.id, cell]));
  const alaska = byId.get('0201'), hawaii = [byId.get('1501'), byId.get('1502')];
  assert.ok(alaska && hawaii.every(Boolean));
  close(Math.hypot(hawaii[0].x - hawaii[1].x, hawaii[0].y - hawaii[1].y), step, 1e-7);
  for (const island of [alaska, ...hawaii]) for (const main of result.cells.filter(cell => mainIds.has(cell.id))) {
    assert.ok(Math.hypot(island.x - main.x, island.y - main.y) > step * 1.00001, 'An inset must not touch the mainland.');
  }
  assert.deepEqual(result.diagnostics.insets.map(inset => [inset.id, inset.regionCount]), [['alaska', 1], ['hawaii', 2]]);
}
function independentMetrics(result) {
  const cells = result.cells, byId = new Map(cells.map(cell => [cell.id, cell]));
  const originalById = new Map(data.regions.map(region => [region.id, region]));
  const adjacent = new Map(cells.map(cell => [cell.id, new Set()]));
  let edgeCount = 0, minimumDistance = Infinity;
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const distance = Math.hypot(cells[i].x - cells[j].x, cells[i].y - cells[j].y);
    minimumDistance = Math.min(minimumDistance, distance);
    if (Math.abs(distance - result.step) < 1e-7 * result.step) {
      adjacent.get(cells[i].id).add(cells[j].id);
      adjacent.get(cells[j].id).add(cells[i].id);
      edgeCount++;
    }
  }
  assert.ok(minimumDistance >= result.step * (1 - 1e-8), 'Distinct regular hex cells must not overlap.');
  let distanceSum = 0, adjacencySum = 0, angleSum = 0, retainedTwice = 0;
  data.regions.forEach((region, i) => {
    const cell = byId.get(region.id), target = result.transformedCenters[i];
    distanceSum += Math.hypot(cell.x - target[0], cell.y - target[1]) / result.referenceStep;
    let missing = 0, angle = 0;
    for (const id of region.neighbors) {
      if (!adjacent.get(region.id).has(id)) missing++; else retainedTwice++;
      const original = originalById.get(id), next = byId.get(id);
      const a = [original.center[0] - region.center[0], original.center[1] - region.center[1]];
      const b = [next.x - cell.x, next.y - cell.y];
      const cosine = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
      angle += Math.acos(Math.max(-1, Math.min(1, cosine)));
    }
    if (region.neighbors.length) {
      adjacencySum += missing / region.neighbors.length;
      angleSum += angle / region.neighbors.length;
    }
  });
  const n = cells.length, perimeter = 6 * n - 2 * edgeCount;
  const circlePerimeter = 2 * Math.sqrt(Math.PI * n * (3 * Math.sqrt(3) / 2));
  const metrics = {distance: distanceSum / n, adjacency: adjacencySum / n, angle: angleSum / n,
    roughness: (perimeter - circlePerimeter) / circlePerimeter};
  metricKeys.forEach(key => close(result.metrics[key], metrics[key], 1e-8));
  assert.equal(result.diagnostics.tileEdges, edgeCount);
  assert.equal(result.diagnostics.retainedEdges, retainedTwice / 2);
  assert.equal(result.diagnostics.unitEdgePerimeter, perimeter);
  return {metrics, edgeCount, retainedEdges: retainedTwice / 2, minimumDistance};
}
const defaultResults = [];
test('Input has all 436 unique districts and 1136 reciprocal geographic edges', () => {
  assert.equal(data.regions.length, 436);
  assert.equal(new Set(expectedIds).size, 436);
  assert.equal(data.regions.reduce((sum, region) => sum + region.neighbors.length, 0) / 2, 1136);
  assert.deepEqual(data.groups.map(group => group.regions.length), [433, 1, 2]);
  const byId = new Map(data.regions.map(region => [region.id, region]));
  data.regions.forEach(region => region.neighbors.forEach(id => assert.ok(byId.get(id)?.neighbors.includes(region.id))));
});
test('Default 16 combinations per orientation: complete, regular, inset-aware layouts', () => {
  for (const shape of ['flat-side', 'flat-base']) {
    const combinations = Jobs.combinations({noise: [0, .05], transform: [.6, 1], smooth: [20], shift: ['none', 'x', 'y', 'xy'], shape});
    assert.equal(combinations.length, 16);
    assert.equal(new Set(combinations.map(parameters => JSON.stringify(parameters))).size, 16);
    for (const parameters of combinations) {
      assert.equal(parameters.seed, 42);
      const result = Jobs.runOne(data, parameters);
      verifyLayout(result, parameters);
      result.index = defaultResults.length;
      defaultResults.push(result);
    }
    console.log(`  ${shape}: 16/16 accepted`);
  }
  report.defaultSweep = {attempted: 32, accepted: defaultResults.length, rejected: 0,
    uniqueLabeledLayouts: new Set(defaultResults.map(result => result.signature)).size,
    shapes: ['flat-side', 'flat-base']};
  return report.defaultSweep;
});
test('Independent Euclidean pairwise checks reproduce all four metrics in both orientations', () => {
  return ['flat-side', 'flat-base'].map(shape => ({shape, ...independentMetrics(defaultResults.find(result => result.parameters.shape === shape))}));
});
test('Seeded full-map generation is exactly repeatable', () => {
  const expected = defaultResults.find(result => result.parameters.noise === .05 && result.parameters.shape === 'flat-base');
  const repeated = Jobs.runOne(data, {...expected.parameters});
  assert.deepEqual(repeated.cells, expected.cells);
  assert.deepEqual(repeated.metrics, expected.metrics);
  assert.deepEqual(repeated.boundary, expected.boundary);
  assert.deepEqual(repeated.transformedCenters, expected.transformedCenters);
  assert.equal(repeated.signature, expected.signature);
});
test('Actual app score/ranking matches independent arithmetic, zero weights and stable ties', () => {
  // Execute only the two pure ranking functions from the app, not the browser UI.
  const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const scoreSource = source.match(/  function score\(result\) \{[^\n]+\}/)?.[0];
  const sortedSource = source.match(/  function sortedResults\(\) \{[^\n]+\}/)?.[0];
  assert.ok(scoreSource && sortedSource, 'Ranking functions changed; update the integration harness.');
  for (const weights of [{distance: 1, adjacency: 1, angle: 1, roughness: 1}, {distance: .2, adjacency: 9, angle: .5, roughness: 0}, {distance: 0, adjacency: 0, angle: 0, roughness: 0}]) {
    const state = {weights, results: [...defaultResults].reverse()};
    const observed = vm.runInNewContext(`${scoreSource}\n${sortedSource}\nsortedResults().map(result => ({index:result.index, cost:score(result)}));`, {state, metricKeys, Collection});
    const independent = [...state.results].map(result => ({index: result.index, cost:
      weights.distance * result.metrics.distance + weights.adjacency * result.metrics.adjacency +
      weights.angle * result.metrics.angle + weights.roughness * result.metrics.roughness})).sort((a, b) => a.cost - b.cost || a.index - b.index);
    assert.equal(JSON.stringify(observed), JSON.stringify(independent));
    if (Object.values(weights).every(weight => weight === 0)) assert.deepEqual(Array.from(observed, result => result.index), defaultResults.map(result => result.index));
  }
});
if (values.full) test('288-combination regression reports explicit rejections and validates every accepted layout', () => {
  const summary = {attempted: 0, accepted: 0, rejected: 0, uniqueLabeledLayouts: 0, rejectionCodes: {}, failures: []};
  const signatures = new Set();
  const expectedRejections = new Set(['BOUNDARY_CROSSING', 'BOUNDARY_DEGENERATE', 'GRID_COUNT', 'GRID_LIMIT', 'SMOOTH_NUMERICAL', 'COINCIDENT_CENTERS']);
  for (const shape of ['flat-side', 'flat-base']) {
    const combinations = Jobs.combinations({noise: [0, .05, .1], transform: [0, .6, .9, 1], smooth: [0, 40, 20], shift: ['none', 'x', 'y', 'xy'], shape});
    assert.equal(combinations.length, 144);
    for (const parameters of combinations) {
      summary.attempted++;
      let result;
      try { result = Jobs.runOne(data, parameters); }
      catch (error) {
        assert.ok(expectedRejections.has(error.code), `Unexpected rejection: ${error.code} ${error.message}`);
        summary.rejected++;
        summary.rejectionCodes[error.code] = (summary.rejectionCodes[error.code] || 0) + 1;
        summary.failures.push({parameters, code: error.code});
        continue;
      }
      verifyLayout(result, parameters);
      signatures.add(result.signature);
      summary.accepted++;
    }
    console.log(`  ${shape} extended sweep complete; ${summary.accepted} accepted / ${summary.attempted} attempted so far`);
  }
  assert.equal(summary.attempted, 288);
  assert.equal(summary.accepted + summary.rejected, 288);
  assert.ok(summary.accepted > 0);
  summary.uniqueLabeledLayouts = signatures.size;
  report.fullSweep = summary;
  return {attempted: summary.attempted, accepted: summary.accepted, rejected: summary.rejected, rejectionCodes: summary.rejectionCodes};
});
test('All runs leave source input unchanged', () => {
  assert.equal(crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex'), sourceFingerprint);
});
report.passed = true;
report.elapsedMs = Date.now() - started;
report.generatedAt = new Date().toISOString();
if (values.report !== undefined) fs.writeFileSync(path.resolve(values.report), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({passed: true, testGroups: report.testGroups.length, elapsedMs: report.elapsedMs, defaultSweep: report.defaultSweep,
  fullSweep: report.fullSweep && {attempted: report.fullSweep.attempted, accepted: report.fullSweep.accepted, rejected: report.fullSweep.rejected, rejectionCodes: report.fullSweep.rejectionCodes}}));
