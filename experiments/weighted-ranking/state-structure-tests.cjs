/* States split: a hand-made case, and the lists published in evidence/layout_scores_output.txt. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Jobs = require('./jobs.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'hex-layouts', 'data.json'), 'utf8'));
let passed = 0;
function test(name, run) { run(); passed++; console.log(`PASS ${name}`); }

test('a state is split only when its cells are not one connected group', () => {
  const regions = ['A', 'A', 'A', 'B', 'B', 'C', undefined].map((state, i) => ({id: String(i), state}));
  // A: three cells in a row. B: two cells two steps apart. C: one cell. The last region has no state.
  const cells = [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [5, 5], [9, 9]].map(([q, r], i) => ({id: String(i), q, r}));
  assert.deepEqual(Jobs.stateStructure(regions, cells), {statesSplit: ['B']});
  cells[4] = {id: '4', q: 1, r: 1};
  assert.deepEqual(Jobs.stateStructure(regions, cells), {statesSplit: []});
  // Touching only through another state's cell does not connect a state.
  cells[1] = {id: '1', q: 3, r: 3};
  assert.deepEqual(Jobs.stateStructure(regions, cells), {statesSplit: ['A']});
});

test('every layout reports its split states, and they match the published lists', () => {
  const expected = [
    ['Original NYU', () => Jobs.originalNyu(data), 'MI'],
    ['fixed-n0p1-t1', () => Jobs.runOne(data, {mode: 'nyu-fixed', noise: .1, transform: 1, seed: 42}), 'FL HI IL MA MD MI NJ NY PA TX WA'],
    ['fixed-n0-t0p6', () => Jobs.runOne(data, {mode: 'nyu-fixed', noise: 0, transform: .6, seed: 42}), 'FL HI IL LA MD MI NC NJ NM NV SC TN TX VA WA WI'],
    ['gen-n0-t0p3-s10-none', () => Jobs.runOne(data, {mode: 'generated', noise: 0, transform: .3, smooth: 10, shift: 'none', shape: 'flat-side', seed: 42}), 'MD MI MS NJ NM NV SC VA'],
    ['gen-n0p05-t1-s40-y', () => Jobs.runOne(data, {mode: 'generated', noise: .05, transform: 1, smooth: 40, shift: 'y', shape: 'flat-side', seed: 42}), 'FL IL IN MD MS NJ NV NY TN VA']
  ];
  for (const [name, run, states] of expected) {
    assert.deepEqual(run().stateMetrics.statesSplit, states.split(' '), name);
  }
});

console.log(`${passed} state structure test groups passed.`);
