// Smoke test: Paul's generator (hex-layouts/engine.js) on the mainland counties, written as a
// hex-layout-lab-v2 file that evidence/evaluate_layouts.py can score.
//   python evidence/build_county_regions.py     (once, makes evidence/data/county_regions.json)
//   node evidence/county_smoke_test.cjs [OUT.json]
//   (default out: evidence/data/county_mainland_smoke_layout.json)
// Uses the generator's default settings (noise 0, transform 1, smooth 20, no shift, flat-side).
// Only the mainland group (lower 48 + DC, 3,108 counties). The full map, with the 29 Alaska and
// 5 Hawaii counties placed as insets, comes from runOne in hex-layouts/jobs.js; see
// node hex-layouts/inset-tests.cjs --county.
const fs = require("fs");
const path = require("path");
const E = require(path.join(__dirname, "..", "hex-layouts", "engine.js"));

const regionsPath = path.join(__dirname, "data", "county_regions.json");
const outPath = path.resolve(process.argv[2] || path.join(__dirname, "data", "county_mainland_smoke_layout.json"));
const data = JSON.parse(fs.readFileSync(regionsPath, "utf8"));
const group = data.groups.find((g) => g.id === "mainland");
const options = {};
const t0 = Date.now();
const result = E.generate(group, options);
const seconds = (Date.now() - t0) / 1000;
const id = "county-mainland-default";
const payload = {
  format: "hex-layout-lab-v2",
  mode: "generated",
  algorithm: E.version,
  source: {projection: data.metadata.projection, projectionScale: data.metadata.projectionScale,
    projectionTranslate: data.metadata.projectionTranslate, sourceSha256: data.metadata.sourceSha256,
    regions: path.relative(path.dirname(__dirname), regionsPath), group: "mainland"},
  candidates: [{id, options: result.options, grid: {origin: result.grid.origin, step: result.step, shape: result.grid.shape},
    cells: result.cells.map((c) => ({id: c.id, q: c.q, r: c.r, x: c.x, y: c.y}))}],
};
fs.writeFileSync(outPath, JSON.stringify(payload) + "\n");
const d = result.diagnostics;
console.log(`${group.regions.length} counties, one layout in ${seconds.toFixed(1)} s`);
console.log(`hex step ${result.step.toFixed(3)} screen units; pairs kept ${d.retainedEdges} of ${d.originalEdges}; hex pairs ${d.tileEdges}; tile components ${d.tileComponents}`);
console.log(`wrote ${path.relative(path.dirname(__dirname), outPath)}`);
