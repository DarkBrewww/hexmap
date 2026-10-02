// Builds ../forsch_kansas.html: the linear baseline next to the morph from their code.
//
//   node build_page.cjs
//
// Reads input/kansas_1st_screen.json, input/source.wkt, out/forsch_frames.json
// (from parse_morph_svg.cjs) and out/stats.csv (from MorphApp).
const fs = require("fs");
const dir = __dirname;
const d = JSON.parse(fs.readFileSync(dir + "/input/kansas_1st_screen.json", "utf8"));
const F = JSON.parse(fs.readFileSync(dir + "/out/forsch_frames.json", "utf8"));

// ---- Linear side: the pairing code from index.html section 3, at the best phase ----
const SAMPLES = 60, PHASES = 240;
function signedArea(ring) {
  let a = 0;
  for (let i = 0, m = ring.length; i < m; i++) { const p = ring[i], q = ring[(i + 1) % m]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}
function linearPairs(ring, corners, [X, Y]) {
  if (Math.sign(signedArea(ring)) !== Math.sign(signedArea(corners))) ring = ring.slice().reverse();
  const m = ring.length, u = new Float64Array(m + 1);
  for (let j = 0; j < m; j++) { const a = ring[j], b = ring[(j + 1) % m]; u[j + 1] = u[j] + Math.hypot(b[0] - a[0], b[1] - a[1]); }
  for (let j = 0; j <= m; j++) u[j] /= u[m];
  const ringAt = (f) => {
    let lo = 0, hi = m;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (u[mid] <= f) lo = mid; else hi = mid; }
    const a = ring[lo], b = ring[(lo + 1) % m], r = (f - u[lo]) / (u[lo + 1] - u[lo]);
    return [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r];
  };
  const hexAt = (f) => {
    f -= Math.floor(f);
    const x = f * 6, k = Math.floor(x) % 6, r = x - Math.floor(x), a = corners[k], b = corners[(k + 1) % 6];
    return [a[0] + (b[0] - a[0]) * r, a[1] + (b[1] - a[1]) * r];
  };
  const dx = [], dy = [];
  let mx = 0, my = 0;
  for (let i = 0; i < SAMPLES; i++) { const p = ringAt(i / SAMPLES); dx.push(p[0]); dy.push(p[1]); mx += p[0]; my += p[1]; }
  mx /= SAMPLES; my /= SAMPLES;
  let best = 0, bestScore = -Infinity;
  for (let q = 0; q < PHASES; q++) {
    let s = 0;
    for (let i = 0; i < SAMPLES; i++) { const h = hexAt(((i * PHASES) / SAMPLES + q) / PHASES); s += (dx[i] - mx) * (h[0] - X) + (dy[i] - my) * (h[1] - Y); }
    if (s > bestScore) { bestScore = s; best = q; }
  }
  const phase = best / PHASES;
  const params = Array.from(u.subarray(0, m));
  for (let k = 0; k < 6; k++) { const f = k / 6 - phase; params.push(f - Math.floor(f)); }
  params.sort((a, b) => a - b);
  const src = [], dst = [];
  let prev = -1;
  for (const f of params) {
    if (f - prev < 1e-12) continue;
    prev = f;
    const a = ringAt(f), b = hexAt(f + phase);
    src.push(a[0], a[1]); dst.push(b[0], b[1]);
  }
  return { best, src, dst };
}
const outline = d.rings.reduce((b, r) => (Math.abs(signedArea(r)) > Math.abs(signedArea(b)) ? r : b));
const lin = linearPairs(outline, d.corners, d.center);
const r3 = (v) => Math.round(v * 1000) / 1000;

// ---- Forsch side: drop the closing point MorphMender appends to every state ----
const closed = F.states.every((s) => s[0][0] === s.at(-1)[0] && s[0][1] === s.at(-1)[1]);
const states = closed ? F.states.map((s) => s.slice(0, -1)) : F.states;

// Segments of the schematic outline as drawn (the cut vertex splits one edge in two).
const sch = F.schematic, dirOf = (a, b) => Math.round(Math.atan2(b[1] - a[1], b[0] - a[0]) / (Math.PI / 12));
const segments = sch.filter((p, i) => dirOf(sch[(i - 1 + sch.length) % sch.length], p) !== dirOf(p, sch[(i + 1) % sch.length])).length;

// ---- Text for the "How the right side was made" box ----
const R = Math.hypot(d.corners[0][0] - d.center[0], d.corners[0][1] - d.center[1]);
const STEP = Math.sqrt(3) * R * (12 / 11.5); // hex grid radius 12, drawn hexes 11.5 (hexmap_data.js)
const slideSteps = Math.hypot(F.slide[0], F.slide[1]) / STEP;
const statsCsv = fs.existsSync(dir + "/out/stats.csv") ? fs.readFileSync(dir + "/out/stats.csv", "utf8") : "";
const stat = (name) => {
  const lines = statsCsv.trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const head = lines[0].split(","), vals = lines[lines.length - 1].split(",");
  const i = head.findIndex((h) => h.trim().toUpperCase() === name);
  return i >= 0 ? vals[i] : null;
};
function runText() {
  const yesNo = (v) => (v == null ? "n/a" : /^true$/i.test(v.trim()) ? "yes" : /^false$/i.test(v.trim()) ? "no" : v.trim());
  const cost = stat("NORMALIZED_TRAVELLED_POINT_DISTANCE");
  return `<code>MorphApp -S OCTILINEAR -T GEODESIC</code> from their tag "publication", algorithm code unmodified. ` +
    `The six GeoTools classes it imports are replaced by small stand-ins (a default JTS geometry factory and WKT reader; the shapefile export is never called). ` +
    `Their own checks on this run: self-crossings ${yesNo(stat("HAS_SELFCROSSINGS"))}, self-contained ${yesNo(stat("IS_SELFCONTAINED"))}` +
    (cost ? `, normalized trace length ${cost}` : "") + `. ` +
    `The page plays their ${F.keyTimes.length} keyframes; between keyframes every vertex moves in a straight line, as in their SVG output.`;
}
const fill = {
  __SCHEMATIC__: `The Census outline (${outline.length} points) is simplified with Douglas-Peucker, each edge is replaced by at most two segments on allowed directions, and slivers shorter than 2 squashed units are folded away: ${segments} segments. This step is ours; the paper starts from outlines that are already schematic.`,
  __SLIDE__: slideSteps.toFixed(1),
  __RUN__: runText(),
};

const data = {
  outline: outline.map((p) => p.map(r3)),
  hex: d.corners.map((p) => p.map(r3)),
  linear: { src: lin.src.map(r3), dst: lin.dst.map(r3) },
  forsch: { keyTimes: F.keyTimes, states, slide: F.slide, placedHex: F.placedHex, segments },
};
let html = fs.readFileSync(dir + "/page_template.html", "utf8");
for (const [k, v] of Object.entries(fill)) html = html.split(k).join(v);
html = html.replace("__DATA__", JSON.stringify(data).replace(/</g, "\\u003c"));
fs.writeFileSync(dir + "/../forsch_kansas.html", html);
console.log(`forsch_kansas.html: ${(html.length / 1024).toFixed(0)} KB, linear ${lin.src.length / 2} points (phase ${lin.best}), forsch ${states.length} keyframes x ${states[0].length} points, slide ${slideSteps.toFixed(2)} hex steps`);
