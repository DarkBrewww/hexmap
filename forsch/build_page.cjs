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

// ---- Check the frames the page will show: directions and crossings ----
const CHECK = (() => {
  const KT = F.keyTimes, frames = 2001, ALLOWED = [0, 30, 90, 150];
  let worst = 0, crossings = 0;
  for (let s = 0; s < frames; s++) {
    const t = s / (frames - 1);
    let i = 0;
    while (i < KT.length - 2 && t > KT[i + 1]) i++;
    const u = Math.min(1, Math.max(0, (t - KT[i]) / (KT[i + 1] - KT[i])));
    const st = states[i].map((p, j) => [p[0] + (states[i + 1][j][0] - p[0]) * u, p[1] + (states[i + 1][j][1] - p[1]) * u]);
    const m = st.length;
    for (let a = 0; a < m; a++) {
      const p = st[a], q = st[(a + 1) % m], dx = q[0] - p[0], dy = p[1] - q[1];
      if (Math.hypot(dx, dy) < 1e-2) continue;
      const ang = (((Math.atan2(dy, dx) * 180) / Math.PI) % 180 + 180) % 180;
      worst = Math.max(worst, Math.min(...ALLOWED.map((b) => Math.min(Math.abs(ang - b), 180 - Math.abs(ang - b)))));
    }
    const o = (a, b, c) => { const v = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); return Math.abs(v) < 1e-7 ? 0 : v; };
    let cross = false;
    for (let a = 0; a < m && !cross; a++) for (let b = a + 2; b < m; b++) {
      if (a === 0 && b === m - 1) continue;
      const A = st[a], A2 = st[(a + 1) % m], B = st[b], B2 = st[(b + 1) % m];
      if (o(A, A2, B) * o(A, A2, B2) < 0 && o(B, B2, A) * o(B, B2, A2) < 0) { cross = true; break; }
    }
    if (cross) crossings++;
  }
  return { frames, worst, crossings };
})();

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
  return `Their <code>MorphApp</code> from tag "publication", run with <code>-S OCTILINEAR -T GEODESIC</code> on Java 11. The algorithm code is unmodified; ` +
    `the GeoTools classes it imports are replaced by 8 small stand-ins (a default JTS geometry factory, a WKT reader, and a shapefile export that is never called). ` +
    `Their correspondence: ${stat("NUMBER_OF_MATCHES")} matches, ${stat("NUMBER_OF_INSERTIONS")} insertions, ${stat("NUMBER_OF_DELETIONS")} deletions, ` +
    `timed in ${stat("NUMBER_OF_TRANSITION_CELLS")} transition cells. Their own checks: self-crossings ${yesNo(stat("HAS_SELFCROSSINGS"))}, self-contained ${yesNo(stat("IS_SELFCONTAINED"))}. ` +
    `The page plays their ${F.keyTimes.length} keyframes with straight-line motion in between, exactly as their SVG output does. ` +
    `Checked over ${CHECK.frames.toLocaleString("en-US")} in-between frames: every edge within ${CHECK.worst.toFixed(2)}° of an allowed direction, ${CHECK.crossings ? CHECK.crossings + " frames crossing" : "no crossings"}.`;
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
console.log(`check: ${CHECK.frames} frames, worst ${CHECK.worst.toFixed(3)} deg, ${CHECK.crossings} crossing frames`);
console.log(`forsch_kansas.html: ${(html.length / 1024).toFixed(0)} KB, linear ${lin.src.length / 2} points (phase ${lin.best}), forsch ${states.length} keyframes x ${states[0].length} points, slide ${slideSteps.toFixed(2)} hex steps`);
