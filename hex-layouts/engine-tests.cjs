/* Hex-layout engine regression tests. Run: node engine-tests.cjs */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const engine = require('./engine.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function close(a, b, epsilon = 1e-8) { assert.ok(Math.abs(a - b) <= epsilon, `${a} != ${b}`); }
function permutations(values) { if (!values.length) return [[]]; return values.flatMap((value, i) => permutations(values.filter((_, j) => i !== j)).map(rest => [value, ...rest])); }
function circle(count = 64) { return Array.from({length: count}, (_, i) => [50 + 35 * Math.cos(i * 2 * Math.PI / count), 50 + 35 * Math.sin(i * 2 * Math.PI / count)]); }
function fixture(count = 7) {
  return {id: 'fixture', boundary: circle(), regions: Array.from({length: count}, (_, i) => ({id: String(i), center: [50 + 15 * Math.cos(i * 2 * Math.PI / count), 50 + 15 * Math.sin(i * 2 * Math.PI / count)], neighbors: Array.from({length: count}, (_, j) => String(j)).filter(id => id !== String(i))}))};
}
test('Hungarian agrees with brute force on 5x5 matrices', () => {
  for (let seed = 0; seed < 10; seed++) {
    const matrix = Array.from({length: 5}, (_, i) => Array.from({length: 5}, (_, j) => ((i * 17 + j * 31 + seed * (i + 1) * (j + 3)) % 41) ** 2));
    const assignment = engine.hungarian(matrix), cost = assignment.reduce((sum, j, i) => sum + matrix[i][j], 0);
    const minimum = Math.min(...permutations([0, 1, 2, 3, 4]).map(p => p.reduce((sum, j, i) => sum + matrix[i][j], 0)));
    assert.equal(cost, minimum); assert.equal(new Set(assignment).size, 5);
  }
});
test('Both orientations have six equally spaced edge neighbors', () => {
  for (const shape of ['flat-side', 'flat-base']) {
    const grid = engine.gridDefinition([12, -7], 20, shape), center = engine.cellAt(0, 0, grid);
    for (const [q, r] of engine.directions) {
      const cell = engine.cellAt(q, r, grid); close(Math.hypot(cell.x - center.x, cell.y - center.y), 20);
      assert.deepEqual(engine.nearestCell([cell.x, cell.y], grid), cell);
      const first = engine.hexCorners(center, 20, shape), second = engine.hexCorners(cell, 20, shape);
      assert.equal(first.filter(a => second.some(b => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8)).length, 2);
    }
  }
});
test('Geometry validation rejects collisions, shifted cells and malformed bases', () => {
  const group = fixture(2), grid = engine.gridDefinition([0, 0], 20, 'flat-side');
  const cells = [Object.assign({id:'0'}, engine.cellAt(0, 0, grid)), Object.assign({id:'1'}, engine.cellAt(1, 0, grid))];
  assert.equal(engine.validate(group, cells, grid).nonOverlapping, true);
  assert.throws(() => engine.validate(group, [cells[0], {...cells[0], id:'1'}], grid), /same cell/);
  assert.throws(() => engine.validate(group, [cells[0], {...cells[1], x: 21}], grid), /outside/);
  assert.throws(() => engine.validate(group, cells, {...grid, basis:[[0,0],[0,0]]}), /basis/);
});
test('Boundary validation detects bowties and includes edge points', () => {
  assert.equal(engine.simplePolygon([[0,0],[2,2],[0,2],[2,0]]), false);
  assert.equal(engine.simplePolygon([[0,0],[2,0],[2,2],[0,2]]), true);
  assert.equal(engine.contains([0,1], [[0,0],[2,0],[2,2],[0,2]]), true);
  assert.equal(engine.contains([3,1], [[0,0],[2,0],[2,2],[0,2]]), false);
});
test('Metrics are exact on seven-cell hex patch, and separate edges from labels', () => {
  for (const shape of ['flat-side', 'flat-base']) {
    const grid = engine.gridDefinition([0,0], 10, shape), axial = [[0,0], ...engine.directions];
    const cells = axial.map(([q,r],i) => Object.assign({id:String(i)}, engine.cellAt(q,r,grid)));
    const regions = cells.map(c => ({id:c.id,center:[c.x,c.y],neighbors:cells.filter(d => d!==c && Math.hypot(c.x-d.x,c.y-d.y)<10.001).map(d=>d.id)}));
    const group = {regions};
    const evaluated = engine.evaluate(group,cells,regions.map(r=>r.center),10,10);
    close(evaluated.metrics.distance,0); close(evaluated.metrics.adjacency,0); close(evaluated.metrics.angle,0);
    assert.equal(evaluated.diagnostics.tileEdges,12); assert.equal(evaluated.diagnostics.unitEdgePerimeter,18); assert.equal(evaluated.diagnostics.tileComponents,1);
    close(evaluated.metrics.roughness,(18-2*Math.sqrt(Math.PI*7*3*Math.sqrt(3)/2))/(2*Math.sqrt(Math.PI*7*3*Math.sqrt(3)/2)));
    const swapped=cells.map(c=>({...c})); [swapped[0].id,swapped[1].id]=[swapped[1].id,swapped[0].id];
    const changed=engine.evaluate(group,swapped,regions.map(r=>r.center),10,10);
    close(changed.metrics.roughness,evaluated.metrics.roughness); assert.ok(changed.metrics.distance>0); assert.ok(changed.metrics.adjacency>0);
  }
});
test('Noise depends on seed/noise only, not orientation or other parameters', () => {
  const group=fixture(),prepared=engine.prepare(group);
  const first=engine.transformCenters(prepared,{noise:.1,transform:0,seed:12},group.id);
  const second=engine.transformCenters(prepared,{noise:.1,transform:1,seed:12},group.id);
  const third=engine.transformCenters(prepared,{noise:.1,transform:1,seed:13},group.id);
  assert.deepEqual(first.noisy,second.noisy); assert.notDeepEqual(first.noisy,third.noisy); assert.deepEqual(first.noisy,first.transformed);
});
test('Centroid refinement is synchronous with fixed original directions', () => {
  const prepared={regions:[{center:[0,0]},{center:[1,0]}],neighbors:[[1],[0]],referenceStep:2};
  const result=engine.transformCenters(prepared,{noise:0,transform:1,seed:1},'two');
  // This bipartite two-node example oscillates; after 30 updates it is back.
  assert.deepEqual(result.transformed,[[0,0],[1,0]]);
});
test('Periodic smoothing is finite and translation equivariant', () => {
  const ring=engine.resampleRing(circle(),256),smooth=engine.smoothBoundary(ring,20);
  const shifted=engine.smoothBoundary(ring.map(p=>[p[0]+100,p[1]-12]),20);
  assert.equal(smooth.length,256); assert.equal(engine.simplePolygon(smooth),true);
  smooth.forEach((p,i)=>{close(shifted[i][0],p[0]+100,1e-6);close(shifted[i][1],p[1]-12,1e-6);});
});
test('Complete deterministic generation works for both hex orientations', () => {
  const group=fixture();
  for(const shape of ['flat-side','flat-base']) {
    const a=engine.generate(group,{shape,transform:0,smooth:0}),b=engine.generate(group,{shape,transform:0,smooth:0});
    assert.equal(a.cells.length,7);assert.deepEqual(a.cells,b.cells);assert.deepEqual(a.metrics,b.metrics);
    assert.equal(a.diagnostics.validity.nonOverlapping,true);
    for(const c of a.cells)assert.equal(engine.contains([c.x,c.y],a.boundary),true);
  }
});
test('Invalid controls fail clearly instead of silently changing them', () => {
  for(const options of [{noise:-1},{transform:1.1},{smooth:2},{shift:'bad'},{shape:'square'},{seed:NaN}])assert.throws(()=>engine.generate(fixture(),options),err=>err.code==='OPTIONS');
});
const dataPath=path.join(__dirname,'data.json');
if(fs.existsSync(dataPath)) test('Actual 433-district data: both orientations, inputs unchanged, all four shifts',()=>{
  const data=JSON.parse(fs.readFileSync(dataPath,'utf8')),group=data.groups.find(g=>g.id==='mainland'),before=JSON.stringify(group);
  assert.equal(group.regions.length,433);
  for(const shape of ['flat-side','flat-base'])for(const shift of ['none','x','y','xy']) {
    const result=engine.generate(group,{shape,shift,noise:0,transform:1,smooth:20});
    assert.equal(result.cells.length,433);assert.equal(result.diagnostics.validity.nonOverlapping,true);
    assert.ok(result.metrics.adjacency>=0&&result.metrics.adjacency<=1);assert.ok(result.metrics.angle>=0&&result.metrics.angle<=Math.PI);
  }
  assert.equal(JSON.stringify(group),before);
});
console.log(`\n${passed} test groups passed.`);
