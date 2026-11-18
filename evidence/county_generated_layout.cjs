// The full county map from Paul's generator, as a file evidence/evaluate_layouts.py can score.
//   node evidence/county_generated_layout.cjs [OUT.json]
//   (default out: evidence/data/county_generated_default.json)
// Same call as hex-layouts/inset-tests.cjs --county: Jobs.runOne on evidence/data/county_regions.json
// at noise 0, transform 1, smooth 20, no shift, flat-side, seed 42 (the mainland is the same layout as
// county_smoke_test.cjs makes; Alaska and Hawaii are placed as insets).
const fs = require("fs");
const path = require("path");
const Jobs = require(path.join(__dirname, "..", "hex-layouts", "jobs.js"));

const outPath = path.resolve(process.argv[2] || path.join(__dirname, "data", "county_generated_default.json"));
const data = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "county_regions.json"), "utf8"));
const parameters = {noise: 0, transform: 1, smooth: 20, shift: "none", shape: "flat-side", seed: 42};
const t0 = Date.now();
const result = Jobs.runOne(data, parameters);
const seconds = (Date.now() - t0) / 1000;
const g = result.grid;
fs.writeFileSync(outPath, JSON.stringify({format: "hex-layout-lab-v2", mode: "generated",
  source: {regions: "evidence/data/county_regions.json", sourceSha256: data.metadata.sourceSha256},
  candidates: [{id: "generator-default", parameters, grid: {origin: g.origin, step: result.step, shape: g.shape},
    cells: result.cells.map((c) => ({id: c.id, q: c.q, r: c.r}))}]}) + "\n");
const d = result.diagnostics;
console.log(`${result.cells.length} counties in ${seconds.toFixed(1)} s; insets ${d.insets.map((i) => `${i.id} ${i.regionCount} at scale ${i.scale.toFixed(3)} in ${i.pieces} pieces`).join(", ")}; tile components ${d.tileComponents}`);
console.log(`wrote ${path.relative(path.dirname(__dirname), outPath)}`);
