/* Inset placement for insets of any size. node inset-tests.cjs [--county]
 * --county also places the county insets of ../evidence/data/county_regions.json
 * (29 Alaska and 5 Hawaii counties; about 20 seconds).
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {parseArgs} = require('node:util');
const {values} = parseArgs({options: {county: {type: 'boolean', default: false}}});
const Engine = require('./engine.js');
const Jobs = require('./jobs.js');
const key = c => `${c.q},${c.r}`;
function test(name, run) { run(); console.log(`PASS ${name}`); }

function square(x0, y0, size) { return [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size]]; }
function gridGroup(id, cols, rows, x0, y0, spacing) {
  const regions = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) regions.push({id: `${id}-${i}-${j}`, center: [x0 + (i + 0.5) * spacing, y0 + (j + 0.5) * spacing], neighbors: []});
  const at = (i, j) => regions[j * cols + i];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (i + 1 < cols) { at(i, j).neighbors.push(at(i + 1, j).id); at(i + 1, j).neighbors.push(at(i, j).id); }
    if (j + 1 < rows) { at(i, j).neighbors.push(at(i, j + 1).id); at(i, j + 1).neighbors.push(at(i, j).id); }
  }
  const boundary = [[x0, y0], [x0 + cols * spacing, y0], [x0 + cols * spacing, y0 + rows * spacing], [x0, y0 + rows * spacing]];
  return {id, regions, boundary};
}
// A square mainland of 6 x 6 regions and six insets.
function syntheticData() {
  const mainland = gridGroup('mainland', 6, 6, 0, 0, 10);
  const one = gridGroup('one', 1, 1, -60, 90, 10);
  const two = gridGroup('two', 2, 1, 40, 110, 10);
  // A chain of neighbouring regions with little land and wide gaps: it must shrink to stay in one piece.
  const chain = gridGroup('chain', 7, 1, 120, 40, 30);
  chain.boundaryRings = chain.regions.map(region => square(region.center[0] - 3, region.center[1] - 3, 6));
  const blob = gridGroup('blob', 4, 3, 120, 140, 14);
  // Islands only, like Hawaii's single-county islands: no region has a land neighbour, so nothing is shrunk for them.
  const islands = gridGroup('islands', 4, 1, -200, 200, 30);
  islands.regions.forEach(region => { region.neighbors = []; });
  islands.boundaryRings = islands.regions.map(region => square(region.center[0] - 3, region.center[1] - 3, 6));
  // A connected body and one island far to the west, like Alaska and Aleutians West.
  const mixed = gridGroup('mixed', 3, 2, -200, -120, 10);
  mixed.regions.push({id: 'mixed-island', center: [-290, -100], neighbors: []});
  mixed.boundaryRings = [mixed.boundary, square(-292, -102, 4)];
  const groups = [mainland, one, two, chain, blob, islands, mixed];
  return {regions: groups.flatMap(g => g.regions), groups};
}
const parameters = {noise: 0, transform: 1, smooth: 20, shift: 'none', shape: 'flat-side', seed: 42};
const isIsland = (group, region) => !(region.neighbors || []).some(id => group.regions.some(other => other.id === id));

function checkInsets(data, result) {
  const groupOf = new Map();
  for (const group of data.groups) for (const region of group.regions) groupOf.set(String(region.id), group.id);
  const byKey = new Map(result.cells.map(cell => [key(cell), cell])), byId = new Map(result.cells.map(cell => [String(cell.id), cell]));
  assert.equal(result.cells.length, data.regions.length);
  assert.equal(byKey.size, data.regions.length, 'Every region needs its own cell.');
  const details = new Map(result.diagnostics.insets.map(inset => [inset.id, inset]));
  for (const group of data.groups.filter(g => g.id !== 'mainland')) {
    const cells = result.cells.filter(cell => groupOf.get(cell.id) === group.id), own = new Set(cells.map(key));
    for (const cell of cells) for (const [dq, dr] of Engine.directions) {
      const other = byKey.get(`${cell.q + dq},${cell.r + dr}`);
      assert.ok(!other || own.has(key(other)), `Inset ${group.id} must not touch another group.`);
    }
    // Pieces of the inset, and the piece of each region.
    const piece = new Map();
    let count = 0;
    for (const start of cells) {
      if (piece.has(key(start))) continue;
      piece.set(key(start), count);
      const stack = [start];
      while (stack.length) {
        const cell = stack.pop();
        for (const [dq, dr] of Engine.directions) { const next = `${cell.q + dq},${cell.r + dr}`; if (own.has(next) && !piece.has(next)) { piece.set(next, count); stack.push(byKey.get(next)); } }
      }
      count++;
    }
    const connected = group.regions.filter(region => !isIsland(group, region)).map(region => piece.get(key(byId.get(String(region.id)))));
    assert.ok(new Set(connected).size <= 1, `Regions of ${group.id} with a land neighbour must form one piece.`);
    if (group.regions.length === 2) assert.equal(count, 1, 'A two-region inset is an adjacent pair.');
    const detail = details.get(group.id);
    assert.equal(detail.regionCount, group.regions.length);
    if (group.regions.length > 2) {
      assert.ok(detail.scale > 0 && detail.scale <= 1, `Scale of ${group.id} must be in (0, 1].`);
      assert.equal(detail.pieces, count, `Reported pieces of ${group.id}.`);
    } else assert.equal(detail.scale, undefined, 'One- and two-region insets keep their earlier placement.');
  }
}
function areaScale(group, step) {
  const rings = group.boundaryRings || [group.boundary];
  const land = rings.reduce((sum, ring) => sum + Math.abs(Engine.polygonArea(ring)), 0);
  return Math.min(1, Math.sqrt(group.regions.length * Math.sqrt(3) / 2 * step ** 2 / land));
}

test('Insets of 1 to 12 regions are placed apart from other groups, with connected regions together', () => {
  const data = syntheticData();
  const result = Jobs.runOne(data, parameters);
  checkInsets(data, result);
  assert.deepEqual(result.diagnostics.insets.map(inset => [inset.id, inset.regionCount]), [['one', 1], ['two', 2], ['chain', 7], ['blob', 12], ['islands', 4], ['mixed', 7]]);
});

test('Large insets keep the relative positions of their regions', () => {
  const data = syntheticData();
  const result = Jobs.runOne(data, parameters);
  const byId = new Map(result.cells.map(cell => [cell.id, cell]));
  for (const id of ['chain', 'blob', 'islands', 'mixed']) {
    const group = data.groups.find(g => g.id === id);
    // West-to-east order of the regions is kept by their cells, pair by pair.
    let agree = 0, total = 0;
    for (const a of group.regions) for (const b of group.regions) if (a.center[0] < b.center[0] - 1e-9) {
      total++; if (byId.get(a.id).x < byId.get(b.id).x + 1e-9) agree++;
    }
    assert.ok(agree / total >= 0.9, `${id}: west-east order kept for ${agree} of ${total} pairs.`);
  }
});

test('Transformed centers of a large inset are its centers scaled about the anchor', () => {
  const data = syntheticData();
  const result = Jobs.runOne(data, parameters);
  const index = new Map(data.regions.map((region, i) => [region.id, i]));
  for (const id of ['chain', 'blob', 'islands', 'mixed']) {
    const group = data.groups.find(g => g.id === id), n = group.regions.length;
    const scale = result.diagnostics.insets.find(inset => inset.id === id).scale;
    const anchor = group.regions.reduce((a, r) => [a[0] + r.center[0] / n, a[1] + r.center[1] / n], [0, 0]);
    for (const region of group.regions) {
      const transformed = result.transformedCenters[index.get(region.id)];
      for (const axis of [0, 1]) assert.ok(Math.abs(transformed[axis] - (anchor[axis] + scale * (region.center[axis] - anchor[axis]))) < 1e-9);
    }
  }
});

test('Only regions with a land neighbour force an inset to shrink', () => {
  const data = syntheticData();
  const result = Jobs.runOne(data, parameters);
  const detail = id => result.diagnostics.insets.find(inset => inset.id === id);
  const group = id => data.groups.find(g => g.id === id);
  // The chain's regions are neighbours, so it shrinks below its land-area scale to stay in one piece.
  assert.ok(detail('chain').scale < areaScale(group('chain'), result.step));
  assert.equal(detail('chain').pieces, 1);
  // Islands alone never shrink: they keep the land-area scale and stand apart.
  assert.equal(detail('islands').scale, areaScale(group('islands'), result.step));
  assert.equal(detail('islands').pieces, 4);
  // The far island of the mixed inset stands apart from the connected body.
  assert.equal(detail('mixed').pieces, 2);
});

test('Placement is deterministic and leaves the input unchanged', () => {
  const data = syntheticData(), before = JSON.stringify(data);
  const a = Jobs.runOne(data, parameters), b = Jobs.runOne(data, parameters);
  assert.equal(a.signature, b.signature);
  assert.equal(JSON.stringify(data), before);
});

test('An inset group without regions is rejected', () => {
  const data = syntheticData();
  data.groups.push({id: 'empty', regions: [], boundary: square(300, 300, 10)});
  assert.throws(() => Jobs.runOne(data, parameters), /has no regions/);
});

if (values.county) test('County insets: 29 Alaska and 5 Hawaii counties', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'evidence', 'data', 'county_regions.json'), 'utf8'));
  const result = Jobs.runOne(data, parameters);
  checkInsets(data, result);
  assert.deepEqual(result.diagnostics.insets.map(inset => [inset.id, inset.regionCount, inset.pieces]), [['alaska', 29, 2], ['hawaii', 5, 4]]);
  // Mainland, Alaska with Aleutians West apart, and Hawaii's four islands (Maui and Kalawao share Molokai).
  assert.equal(result.diagnostics.tileComponents, 7);
});
