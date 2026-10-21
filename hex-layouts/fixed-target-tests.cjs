/* Fixed NYU geometry, assignment, metrics, and reproducibility checks. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Engine = require('./engine.js');
const Jobs = require('./jobs.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
const unchanged = JSON.stringify(data);
const ids = data.regions.map(region => region.id).sort();
const targetById = new Map(data.nyuTarget.cells.map(cell => [cell.originalId, cell]));
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }
function close(a, b, tolerance = 1e-9) { assert.ok(Math.abs(a - b) <= tolerance, `${a} differs from ${b}`); }
function verifyGeometry(result) {
  assert.equal(result.cells.length, 436);
  assert.deepEqual(result.cells.map(cell => cell.id).sort(), ids);
  assert.deepEqual(result.cells.map(cell => cell.targetId).sort(), ids);
  assert.equal(result.radius, data.nyuTarget.radius);
  assert.equal(result.step, data.nyuTarget.step);
  assert.deepEqual(result.grid, data.nyuTarget.grid);
  for (const cell of result.cells) {
    const source = targetById.get(cell.targetId);
    for (const field of ['x', 'y', 'q', 'r']) assert.equal(cell[field], source[field], `${field} must remain exactly fixed.`);
    assert.equal(cell.originalId, source.originalId);
  }
  assert.equal(result.diagnostics.fixedGeometry, true);
  assert.equal(result.diagnostics.targetChanged, false);
  assert.equal(result.diagnostics.fitIterations, 0);
  assert.equal(result.diagnostics.fullCoverage, 436);
  assert.equal(result.diagnostics.uniqueCells, 436);
  assert.equal(result.diagnostics.validity.nonOverlapping, true);
  for (const value of Object.values(result.metrics)) assert.ok(Number.isFinite(value) && value >= 0);
}
function independentMetrics(result) {
  const cells = result.cells, cellsById = new Map(cells.map(cell => [cell.id, cell]));
  const originalById = new Map(data.regions.map(region => [region.id, region]));
  const adjacent = new Map(cells.map(cell => [cell.id, new Set()]));
  let edges = 0;
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const distance = Math.hypot(cells[i].x - cells[j].x, cells[i].y - cells[j].y);
    // The imported decimal centers differ from ideal lattice positions by <1e-7 step.
    if (Math.abs(distance - result.step) < 1e-6 * result.step) {
      adjacent.get(cells[i].id).add(cells[j].id);
      adjacent.get(cells[j].id).add(cells[i].id);
      edges++;
    }
    assert.ok(distance >= Math.sqrt(3) * result.radius, 'Drawn fixed hexagons must have disjoint interiors.');
  }
  let distance = 0, missing = 0, angle = 0, originalDistance = 0, retainedTwice = 0;
  data.regions.forEach((region, i) => {
    const cell = cellsById.get(region.id), reference = result.transformedCenters[i];
    distance += Math.hypot(cell.x - reference[0], cell.y - reference[1]) / result.referenceStep;
    originalDistance += Math.hypot(cell.x - region.center[0], cell.y - region.center[1]) / result.referenceStep;
    let localMissing = 0, localAngle = 0;
    for (const id of region.neighbors) {
      if (!adjacent.get(region.id).has(id)) localMissing++; else retainedTwice++;
      const original = originalById.get(id), next = cellsById.get(id);
      const a = [original.center[0] - region.center[0], original.center[1] - region.center[1]];
      const b = [next.x - cell.x, next.y - cell.y];
      const cosine = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
      localAngle += Math.acos(Math.max(-1, Math.min(1, cosine)));
    }
    if (region.neighbors.length) { missing += localMissing / region.neighbors.length; angle += localAngle / region.neighbors.length; }
  });
  const n = cells.length, perimeter = 6 * n - 2 * edges;
  const circle = 2 * Math.sqrt(Math.PI * n * 3 * Math.sqrt(3) / 2);
  const metrics = {distance: distance / n, adjacency: missing / n, angle: angle / n, roughness: (perimeter - circle) / circle};
  for (const key of Object.keys(metrics)) close(result.metrics[key], metrics[key]);
  close(result.diagnostics.originalDisplacementMean, originalDistance / n);
  assert.equal(result.diagnostics.retainedEdges, retainedTwice / 2);
  assert.equal(result.diagnostics.tileEdges, edges);
  assert.equal(edges, 1171);
}
const baseline = Jobs.originalNyu(data);
const combinations = Jobs.combinations({mode: 'nyu-fixed', noise: [0, .05, .1, .2], transform: [0, .6, 1], smooth: [3, 20, 40], shift: ['none', 'x'], shape: 'flat-base'});
const results = [];
test('Original NYU baseline preserves every district label and exact target coordinate', () => {
  verifyGeometry(baseline);
  assert.equal(baseline.mode, 'nyu-original');
  assert.equal(baseline.baseline, true);
  assert.equal(baseline.diagnostics.changedAssignments, 0);
  for (const cell of baseline.cells) assert.equal(cell.id, cell.targetId);
  assert.deepEqual(baseline.transformedCenters, data.regions.map(region => region.center));
  independentMetrics(baseline);
});
test('Fixed candidates vary only Noise and Transform and retain exact NYU cells and radius', () => {
  assert.equal(combinations.length, 12);
  for (const parameters of combinations) {
    assert.equal(parameters.shape, 'flat-side');
    assert.equal(parameters.smooth, 0);
    assert.equal(parameters.shift, 'none');
    const result = Jobs.runOne(data, parameters);
    verifyGeometry(result);
    assert.equal(result.mode, 'nyu-fixed');
    assert.equal(result.baseline, false);
    assert.deepEqual(result.parameters, parameters);
    close(result.metrics.roughness, baseline.metrics.roughness, 0);
    results.push(result);
  }
  assert.ok(new Set(results.map(result => result.signature)).size > 1, 'The parameter sweep must produce multiple district assignments.');
});
test('Independent full-map geometry calculations reproduce all fixed-target metrics', () => {
  independentMetrics(results[0]);
  independentMetrics(results.at(-1));
});
test('Fixed and generated modes use identical source transformations for matched parameters', () => {
  const fixed = results.find(result => result.parameters.noise === .05 && result.parameters.transform === 1);
  const generated = Jobs.runOne(data, {mode: 'generated', noise: .05, transform: 1, smooth: 20, shift: 'none', shape: 'flat-side', seed: 42});
  assert.deepEqual(fixed.transformedCenters, generated.transformedCenters);
  assert.equal(fixed.referenceStep, generated.referenceStep);
  assert.equal(generated.mode, 'generated');
  assert.notDeepEqual(generated.cells.map(cell => [cell.x, cell.y]), fixed.cells.map(cell => [cell.x, cell.y]));
});
test('Hungarian reassignment does not increase squared distance relative to original NYU labels', () => {
  const result = results.find(result => result.parameters.noise === 0 && result.parameters.transform === 0);
  const cost = value => value.cells.reduce((sum, cell, i) => sum + (cell.x - data.regions[i].center[0]) ** 2 + (cell.y - data.regions[i].center[1]) ** 2, 0);
  assert.ok(cost(result) <= cost(baseline) + 1e-7);
  assert.ok(result.diagnostics.changedAssignments > 0);
});
test('Fixed-target generation is deterministic and geometry controls are ignored', () => {
  const expected = results[4];
  const repeated = Jobs.runOne(data, {...expected.parameters, smooth: 99, shift: 'xy', shape: 'flat-base'});
  assert.deepEqual(repeated, expected);
});
test('Missing, malformed, and displaced targets fail instead of changing the fixed geometry', () => {
  const options = combinations[0];
  assert.throws(() => Jobs.runOne({...data, nyuTarget: null}, options), /target must contain/);
  const duplicate = structuredClone(data);
  duplicate.nyuTarget.cells[1] = {...duplicate.nyuTarget.cells[0]};
  assert.throws(() => Jobs.runOne(duplicate, options));
  const displaced = structuredClone(data);
  displaced.nyuTarget.cells[0].x += data.nyuTarget.step / 10;
  assert.throws(() => Jobs.runOne(displaced, options), /outside/);
  const enlarged = structuredClone(data);
  enlarged.nyuTarget.radius *= 2;
  assert.throws(() => Jobs.runOne(enlarged, options), /radius/);
  assert.throws(() => Jobs.runOne(data, {...options, noise: -1}), /Noise/);
  assert.throws(() => Jobs.runOne(data, {...options, transform: 2}), /Transform/);
  assert.throws(() => Jobs.runOne(data, {...options, mode: 'unknown'}), /Unknown layout mode/);
});
test('Fixed-target runs leave all source data unchanged', () => { assert.equal(JSON.stringify(data), unchanged); });
console.log(JSON.stringify({passed: true, testGroups: passed, attempted: results.length, uniqueAssignments: new Set(results.map(result => result.signature)).size,
  fixedRoughness: baseline.metrics.roughness, originalMeanDisplacement: baseline.diagnostics.originalDisplacementMean,
  minimumMeanDisplacement: Math.min(...results.map(result => result.diagnostics.originalDisplacementMean))}));
