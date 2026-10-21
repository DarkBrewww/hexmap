"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const Importer = require("./layout-import.js");
const ids = ["0101", "0102", "0103", "0104"];
let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function fixture(shape = "flat-side", mode = "generated") {
  const step = 20, origin = [480, 250];
  const basis = shape === "flat-side" ? [[step, 0], [step / 2, Math.sqrt(3) * step / 2]] : [[Math.sqrt(3) * step / 2, step / 2], [0, step]];
  const cells = [[0, 0], [1, 0], [0, 1], [3, 0]].map(([q, r], i) => ({id: ids[i], q, r,
    x: origin[0] + q * basis[0][0] + r * basis[1][0], y: origin[1] + q * basis[0][1] + r * basis[1][1]}));
  return {format: "hex-layout-lab-v2", mode, source: {projection: "d3.geoAlbersUsa()", projectionScale: 1070, projectionTranslate: [480, 250]},
    candidates: [{id: 7, mode, parameters: {shape, noise: 0, transform: 1, smooth: 0, shift: "none"},
      grid: {origin, step, shape, basis}, step, radius: step / Math.sqrt(3) * (mode === "nyu-fixed" ? 11.5 / 12 : 1), cells}]};
}
function rejects(change, pattern) { const data = fixture(); change(data); assert.throws(() => Importer.parse(data, ids), pattern); }

test("generated orientations preserve exact geometry and reconstruct adjacency", () => {
  for (const shape of ["flat-side", "flat-base"]) {
    const data = fixture(shape), before = JSON.stringify(data), result = Importer.parse(data, ids)[0];
    assert.equal(result.shape, shape); assert.deepEqual(result.cells, data.candidates[0].cells);
    assert.deepEqual(result.neighbors["0101"].sort(), ["0102", "0103"]);
    assert.deepEqual(result.neighbors["0104"], []);
    assert.equal(JSON.stringify(data), before);
    result.cells[0].x = 0; assert.notEqual(data.candidates[0].cells[0].x, 0);
  }
});
test("fixed NYU keeps drawn gutters and matches assigned IDs, not previous occupants", () => {
  const data = fixture("flat-side", "nyu-fixed");
  data.candidates[0].cells.forEach(cell => { cell.originalId = "9999"; cell.targetId = "9999"; });
  const result = Importer.parse(JSON.stringify(data), ids)[0];
  assert.equal(result.radius, data.candidates[0].radius);
  assert.deepEqual(result.cells.map(cell => cell.id), ids);
});
test("rejects invalid JSON, format, empty batch, and invalid expected IDs", () => {
  assert.throws(() => Importer.parse("{", ids), /valid JSON/);
  rejects(data => { data.format = "unknown"; }, /v2/);
  rejects(data => { data.candidates = []; }, /between 1 and 512/);
  assert.throws(() => Importer.parse(fixture(), ["0101", "0101"]), /viewer district IDs/);
});
test("rejects unknown, duplicate, missing, or numeric district IDs", () => {
  rejects(data => { data.candidates[0].cells[0].id = "9999"; }, /district ID/);
  rejects(data => { data.candidates[0].cells[0].id = "0102"; }, /district ID/);
  rejects(data => { data.candidates[0].cells.pop(); }, /exactly 4/);
  rejects(data => { data.candidates[0].cells[0].id = 101; }, /district ID/);
});
test("rejects duplicate cells and off-lattice positions", () => {
  rejects(data => { Object.assign(data.candidates[0].cells[1], {...data.candidates[0].cells[0], id: "0102"}); }, /same cell/);
  rejects(data => { data.candidates[0].cells[0].x += 1; }, /axial grid/);
  rejects(data => { data.candidates[0].cells[0].q = 0.2; }, /bounded integers/);
});
test("rejects non-finite or unreasonable geometry and oversized tiles", () => {
  rejects(data => { data.candidates[0].cells[0].x = Infinity; }, /finite/);
  rejects(data => { data.candidates[0].cells[0].x = 1e9; }, /finite/);
  rejects(data => { data.candidates[0].radius *= 1.1; }, /radius/);
  rejects(data => { data.candidates[0].radius = 0; }, /radius/);
  rejects(data => { data.candidates[0].step = -1; }, /spacing/);
});
test("rejects inconsistent lattice orientation, basis, and projection", () => {
  rejects(data => { data.candidates[0].parameters.shape = "flat-base"; }, /orientation/);
  rejects(data => { data.candidates[0].grid.basis[0][0] += 1; }, /basis/);
  rejects(data => { data.source.projection = "d3.geoMercator()"; }, /geoAlbersUsa/);
  rejects(data => { data.source.projectionScale = 1000; }, /1070/);
  rejects(data => { data.source.projectionTranslate = [0, 0]; }, /480, 250/);
});
test("requires explicit projection metadata and validates optional source hash", () => {
  rejects(data => { delete data.source; }, /metadata is required/);
  rejects(data => { delete data.source.projection; }, /geoAlbersUsa/);
  rejects(data => { delete data.source.projectionScale; }, /1070/);
  rejects(data => { delete data.source.projectionTranslate; }, /480, 250/);
  rejects(data => { data.source.sourceSha256 = "bad-hash"; }, /64 hexadecimal/);
  rejects(data => { data.source.sourceSha256 = "z".repeat(64); }, /64 hexadecimal/);
  rejects(data => { data.source.sourceSha256 = 123; }, /64 hexadecimal/);
  const data = fixture(); data.source.sourceSha256 = "A0".repeat(32);
  assert.equal(Importer.parse(data, ids)[0].metadata.sourceSha256, "a0".repeat(32));
});
test("rejects duplicate candidate IDs and preserves export order", () => {
  const data = fixture(); data.candidates.push(structuredClone(data.candidates[0]));
  assert.throws(() => Importer.parse(data, ids), /candidate IDs/);
  data.candidates[1].id = 2;
  assert.deepEqual(Importer.parse(data, ids).map(candidate => candidate.id), ["7", "2"]);
});
test("browser UMD export is available without CommonJS", () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "layout-import.js"), "utf8"), context);
  assert.equal(typeof context.HexLayoutImport.parse, "function");
});
if (process.argv[2]) {
  test("actual exported layout covers every current Census district", () => {
    const context = {window: {}};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "hexmap_data.js"), "utf8"), context);
    const expected = Array.from(context.window.HEXMAP_DATA.features, feature => feature.properties.geo_fips);
    const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const result = Importer.parse(payload, expected);
    assert.equal(result.length, payload.candidates.length);
    result.forEach((candidate, index) => {
      assert.equal(candidate.cells.length, 436);
      candidate.cells.forEach((cell, i) => { assert.equal(cell.x, payload.candidates[index].cells[i].x); assert.equal(cell.y, payload.candidates[index].cells[i].y); });
      const edgeCount = Object.values(candidate.neighbors).reduce((sum, neighbors) => sum + neighbors.length, 0) / 2;
      if (candidate.mode === "nyu-fixed") assert.equal(edgeCount, 1171);
    });
    console.log(`Validated ${result.length} candidates, each with 436 exact district assignments.`);
  });
}
console.log(`${passed} layout import tests passed.`);
