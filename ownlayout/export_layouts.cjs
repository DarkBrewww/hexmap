"use strict";
// Writes GridMapPipeline runs as a hex-layout-lab-v2 export, the JSON format of hex-layouts/, so the
// morph viewer can load them with "Import layout JSON".
//
//   node ownlayout/export_layouts.cjs                       (the two layouts in the README)
//   node ownlayout/export_layouts.cjs OUT.json ID=RUN.tsv [ID=RUN.tsv ...] [--radius-ratio=X]
//
// A run's TSV has one line per district: cell x, cell y, district ID. GridMapPipeline's hexagons are
// pointy-top with axial coordinates (x, y) and y up, which is the viewer's flat-side lattice with
// q = x and r = -y. The cells are placed on the projected map the way index.html places the NYU
// layout: one uniform scale and one shift, by least squares from hex centres to district centroids.
// The drawn radius is 11.5/12 of the touching radius by default, as for the NYU layout.
//
// Before writing, the file is read back with layout-import.js, the parser the viewer uses.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const Engine = require(path.join(root, "hex-layouts", "engine.js"));
const Import = require(path.join(root, "layout-import.js"));
const data = JSON.parse(fs.readFileSync(path.join(root, "hex-layouts", "data.json"), "utf8"));
const SQRT3 = Math.sqrt(3);

const DEFAULT_OUT = path.join(__dirname, "meulemans_layouts.json");
const DEFAULT_RUNS = [
  ["meulemans-states-p5-d5-s1", path.join(__dirname, "runs", "states_p5_d5_s1.tsv"),
    "Every state is an outline of its own; the lower 48 and DC form one joint cartogram, Alaska and Hawaii are composed. No state is split."],
  ["meulemans-nostates-p5-d5-s1", path.join(__dirname, "runs", "noparts_p5_d5_s1.tsv"),
    "The lower 48 and DC as one outline, so the pipeline's parts can cross state lines."],
];

const args = process.argv.slice(2);
const options = Object.fromEntries(args.filter(a => a.startsWith("--")).map(a => a.slice(2).split("=")));
const positional = args.filter(a => !a.startsWith("--"));
const radiusRatio = options["radius-ratio"] !== undefined ? Number(options["radius-ratio"]) : 11.5 / 12;
if (!(radiusRatio > 0 && radiusRatio <= 1)) throw new Error("--radius-ratio must be in (0, 1].");
const out = positional[0] || DEFAULT_OUT;
const runs = positional.length > 1
  ? positional.slice(1).map(spec => { const i = spec.indexOf("="); return [spec.slice(0, i), spec.slice(i + 1), ""]; })
  : DEFAULT_RUNS;

const regions = data.regions;
const ids = regions.map(r => String(r.id));
const byId = new Map(regions.map(r => [String(r.id), r]));
const mainland = data.groups.find(g => g.id === "mainland");
const referenceStep = Engine.prepare(mainland).referenceStep;
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
// Fingerprint of the hexmap_data.js in this checkout, which the viewer compares on import.
const sourceSha256 = sha256(fs.readFileSync(path.join(root, "hexmap_data.js")));

function readRun(file) {
  const rows = fs.readFileSync(file, "utf8").trim().split(/\r?\n/).map(line => line.split("\t"));
  const seen = new Set(), cells = new Set();
  const out = rows.map(([x, y, id], i) => {
    if (!/^-?\d+$/.test(x) || !/^-?\d+$/.test(y) || !byId.has(id) || seen.has(id)) throw new Error(`${file}:${i + 1}: bad row`);
    if (cells.has(`${x},${y}`)) throw new Error(`${file}:${i + 1}: cell used twice`);
    seen.add(id); cells.add(`${x},${y}`);
    return {id, q: Number(x), r: -Number(y)};
  });
  if (out.length !== regions.length) throw new Error(`${file}: ${out.length} districts, expected ${regions.length}`);
  return out;
}

// Least squares: screen = origin + step * p, p = q*(1, 0) + r*(1/2, sqrt3/2), against district centroids.
function place(axial) {
  const n = axial.length;
  const P = axial.map(({q, r}) => [q + r / 2, SQRT3 * r / 2]), C = axial.map(({id}) => byId.get(id).center);
  const mean = A => [A.reduce((s, a) => s + a[0], 0) / n, A.reduce((s, a) => s + a[1], 0) / n];
  const [pmx, pmy] = mean(P), [cmx, cmy] = mean(C);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = P[i][0] - pmx, dy = P[i][1] - pmy;
    num += dx * (C[i][0] - cmx) + dy * (C[i][1] - cmy); den += dx * dx + dy * dy;
  }
  const step = num / den;
  // Put the lattice origin on the first district's cell (Alabama's 1st), as the NYU target does.
  const first = axial.find(c => c.id === ids[0]);
  const p0 = [first.q + first.r / 2, SQRT3 * first.r / 2];
  const grid = Engine.gridDefinition([cmx + step * (p0[0] - pmx), cmy + step * (p0[1] - pmy)], step, "flat-side");
  const cells = axial.map(({id, q, r}) => ({id, ...Engine.cellAt(q - first.q, r - first.r, grid)}))
    .sort((a, b) => a.id.localeCompare(b.id));
  return {step, grid, cells};
}

// The two scores hex-layouts/ has no counterpart for: states split into pieces, and state borders kept
// (two states that share a border on the map also touch somewhere in the layout).
function stateScores(cells) {
  const at = new Map(cells.map(c => [`${c.q},${c.r}`, c.id]));
  const touching = id => { const c = cells.find(x => x.id === id); return Engine.directions.map(([dq, dr]) => at.get(`${c.q + dq},${c.r + dr}`)).filter(Boolean); };
  const hexNb = new Map(cells.map(c => [c.id, touching(c.id)]));
  const state = id => byId.get(id).state;
  const statesSplit = [];
  for (const s of [...new Set(regions.map(r => r.state))].sort()) {
    const members = ids.filter(id => state(id) === s), seen = new Set([members[0]]), stack = [members[0]];
    while (stack.length) for (const n of hexNb.get(stack.pop())) if (state(n) === s && !seen.has(n)) { seen.add(n); stack.push(n); }
    if (seen.size < members.length) statesSplit.push(s);
  }
  const pairKey = (a, b) => [a, b].sort().join("-");
  const mapBorders = new Set(), hexBorders = new Set();
  for (const r of regions) for (const n of r.neighbors) if (state(n) !== r.state) mapBorders.add(pairKey(r.state, state(n)));
  for (const [id, nb] of hexNb) for (const n of nb) if (state(n) !== state(id)) hexBorders.add(pairKey(state(id), state(n)));
  return {statesSplit, stateBordersKept: [...mapBorders].filter(k => hexBorders.has(k)).length, stateBorders: mapBorders.size};
}

const candidates = runs.map(([id, file, description], index) => {
  const text = fs.readFileSync(file);
  const {step, grid, cells} = place(readRun(file));
  Engine.validate({regions}, cells, grid);
  const evaluation = Engine.evaluate({id: "all", regions}, cells, regions.map(r => r.center), step, referenceStep);
  const name = path.basename(file), seed = /_s(\d+)\.tsv$/.exec(name);
  return {
    rank: index + 1, id, mode: "generated",
    ...(description ? {description} : {}),
    parameters: {shape: "flat-side", ...(seed ? {seed: Number(seed[1])} : {})},
    pipeline: {code: "github.com/tue-alga/GridMapPipeline f1c18c0, GeometryCore c4f7faa", run: path.relative(root, file).split(path.sep).join("/"), runSha256: sha256(text),
      placement: "least squares from hex centres to district centroids (uniform scale and shift)", radiusRatio},
    metrics: evaluation.metrics, stateMetrics: stateScores(cells), diagnostics: evaluation.diagnostics,
    referenceStep, step, radius: radiusRatio * step / SQRT3, grid, cells,
  };
});

const payload = {
  format: "hex-layout-lab-v2", mode: "generated", algorithm: "gridmap-pipeline-meulemans-2026",
  source: {
    schemaVersion: data.metadata.schemaVersion, projection: data.metadata.projection, coordinateSystem: data.metadata.coordinateSystem,
    projectionScale: data.metadata.projectionScale, projectionTranslate: data.metadata.projectionTranslate,
    representativePoint: data.metadata.representativePoint, adjacency: data.metadata.adjacency, sourceSha256,
  },
  exportedCount: candidates.length, candidates,
};

// Pretty-print with one cell per line, so the file stays readable and diffs stay small.
let text = JSON.stringify({...payload, candidates: candidates.map((c, i) => ({...c, cells: `@cells${i}@`}))}, null, 2);
candidates.forEach((c, i) => {
  text = text.replace(`"@cells${i}@"`, "[\n" + c.cells.map(cell => "        " + JSON.stringify(cell)).join(",\n") + "\n      ]");
});
text += "\n";

// Read it back the way the viewer does, and check the adjacency it rebuilds.
const parsed = Import.parse(text, ids);
parsed.forEach((p, i) => {
  const pairs = Object.values(p.neighbors).reduce((s, nb) => s + nb.length, 0) / 2;
  if (pairs !== candidates[i].diagnostics.tileEdges) throw new Error(`${p.id}: neighbour count changed on import`);
});
fs.writeFileSync(out, text);
for (const c of candidates) {
  const m = c.stateMetrics, d = c.diagnostics;
  console.log(`${c.id}: step ${c.step.toFixed(3)}, radius ${c.radius.toFixed(3)}, map pairs kept ${d.retainedEdges}/${d.originalEdges}, hex pairs ${d.tileEdges}, ` +
    `state borders kept ${m.stateBordersKept}/${m.stateBorders}, states split ${m.statesSplit.join(",") || "none"}`);
}
console.log(`wrote ${path.relative(process.cwd(), out)} (${candidates.length} candidates, source ${sourceSha256.slice(0, 12)})`);
